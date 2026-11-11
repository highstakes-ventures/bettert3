"""Deferred, recoverable replacement of the existing custom desktop installation."""

import fcntl
import json
import os
from pathlib import Path
import signal
import sys
import time
import urllib.error
import urllib.parse

from custom_runtime import atomic, clone, digest, load_runtime, process, run, suspended, wait


TERMINAL = {"activated", "rolled-back", "recovery-required", "deferred"}


class Installer:
    def __init__(self, runtime, directory):
        self.runtime = runtime
        self.directory = Path(directory)
        self.journal = self.directory / "progress.json"

    def state(self):
        return json.loads(self.journal.read_text())

    def record(self, phase, **fields):
        state = self.state()
        state.update(phase=phase, updatedAt=time.time(), **fields)
        atomic(self.journal, state)
        print(json.dumps({"phase": phase, **fields}), flush=True)
        return state

    def select(self, release, revision):
        state = self.runtime.selected()
        if state["release"] != release:
            state.pop("startingDesktop", None)
        state.update(release=release, revision=revision, installJournal=str(self.journal))
        atomic(self.runtime.pointer, state)

    def bootstrap(self, config_path):
        runtime, state = self.runtime, self.state()
        if state.get("bootstrapComplete"):
            return
        module = Path(__file__).with_name("custom_runtime.py")
        python = "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3"
        shim = ("import os, sys\n" + "os.execv(" + repr(python) + ", [" + repr(python) + ", " +
                repr(str(module)) + ", " + repr(str(config_path)) + ", *sys.argv[1:]])\n")
        old_release = Path(state["oldRelease"])
        bundle = old_release / "apps/desktop/.electron-runtime/T3 Code (Dev).app"
        url_launcher = bundle / "Contents/MacOS/T3 Code (Dev) Launcher"
        with runtime.gate():
            if runtime.selected()["release"] != state["oldRelease"]:
                raise RuntimeError("The installation changed before launcher bootstrap.")
            temporary = runtime.launcher.with_name("launch.py.tmp")
            temporary.write_text(shim)
            with temporary.open("rb") as source:
                os.fsync(source.fileno())
            os.replace(temporary, runtime.launcher)
            from custom_runtime import sync_directory
            sync_directory(runtime.launcher.parent)
            runtime.prepare_bundle(old_release, old_release)
            runtime.prepare_bundle(Path(state["release"]), old_release)
            legacy = []
            lock_users = run(["/usr/sbin/lsof", "-t", runtime.lock]).split()
            legacy_paths = [str(runtime.launcher), str(url_launcher),
                str(runtime.launcher.parent.parent / "MacOS/../Resources/launch.py")]
            for line in run(["/bin/ps", "-axo", "pid=,args="]).splitlines():
                pid_text, _, command = line.strip().partition(" ")
                pid = int(pid_text)
                if any(path in command for path in legacy_paths) or pid_text in lock_users:
                    if pid != os.getpid():
                        legacy.append({"pid": pid, "identity": process(pid)})
            self.record(self.state()["phase"], legacyLaunchers=legacy)
        # Old invocations finish against the unchanged old selection before cutover is enabled.
        for entry in legacy:
            wait(lambda: not process(entry["pid"]) or str(module) in process(entry["pid"]), 180)
        with runtime.gate():
            desktop_pid = runtime.owned(old_release)[2]["pid"]
            main_entry = str(old_release / "apps/desktop/dist-electron/main.cjs")
            for line in run(["/bin/ps", "-axo", "pid=,args="]).splitlines():
                pid_text, _, command = line.strip().partition(" ")
                if main_entry in command and int(pid_text) != desktop_pid:
                    pid = int(pid_text)
                    wait(lambda: not process(pid), 180)
            self.record("prepared", bootstrapComplete=True)
            pointer = runtime.selected()
            pointer["installJournal"] = str(self.journal)
            atomic(runtime.pointer, pointer)

    def guards(self):
        state = self.state()
        if self.runtime.selected()["release"] != state["oldRelease"]:
            raise RuntimeError("The installed release changed. Preserve that installation.")
        for name, release in [("artifact-hashes.json", state["release"]),
                              ("old-artifact-hashes.json", state["oldRelease"])]:
            expected = json.loads((self.directory / name).read_text())
            if any(digest(Path(release) / path) != value for path, value in expected.items()):
                raise RuntimeError("A prepared runtime artifact changed.")
        if run(["git", "ls-remote", "origin", "refs/heads/main"], cwd=state["source"]).split()[0] != state["publishedRevision"]:
            raise RuntimeError("Fork main advanced. Reconcile before activating.")
        if os.statvfs(self.runtime.primary).f_bavail * os.statvfs(self.runtime.primary).f_frsize < 2 * 1024**3:
            raise RuntimeError("Insufficient disk headroom for migration and recovery.")

    def freeze(self, release, purpose="install"):
        owners = self.runtime.owned(release)
        backend = owners[0]
        self.record("quiescing", frozenBackend=backend, quiescePurpose=purpose)
        if process(backend["pid"]) != backend["identity"]:
            raise RuntimeError("Backend ownership changed before quiescence.")
        os.kill(backend["pid"], signal.SIGSTOP)
        wait(lambda: suspended(backend["pid"]), 5)
        return owners

    def unfreeze(self):
        frozen = self.state().get("frozenBackend")
        if frozen and process(frozen["pid"]) == frozen["identity"]:
            os.kill(frozen["pid"], signal.SIGCONT)

    def cutover(self):
        state, runtime = self.state(), self.runtime
        owners = self.freeze(state["oldRelease"])
        try:
            if runtime.active():
                self.unfreeze()
                self.record("waiting-for-idle", frozenBackend=None)
                return False
            self.record("stopping", oldOwners=owners)
            runtime.stop_owned(state["oldRelease"], owners)
        except BaseException:
            self.unfreeze()
            raise
        self.record("backing-up", frozenBackend=None)
        self.finish_backup_and_switch()
        return True

    def finish_backup_and_switch(self):
        state, runtime = self.state(), self.runtime
        backup = self.directory / "before"
        if not (backup / "manifest.json").exists():
            if backup.exists():
                import shutil
                shutil.rmtree(backup)
            runtime.snapshot(backup)
            atomic(backup / "counts.json", runtime.counts())
            atomic(backup / "pointer.json", runtime.selected())
        if not (backup / "counts.json").exists() or not (backup / "pointer.json").exists():
            # No target has started yet. Rebuild an interrupted backup from the stopped source.
            import shutil
            shutil.rmtree(backup)
            return self.finish_backup_and_switch()
        self.record("switching")
        self.select(state["release"], state["revision"])
        self.record("starting-target")
        self.start_and_verify()

    def start_and_verify(self):
        state = self.state()
        try:
            if self.runtime.selected().get("startingDesktop"):
                self.runtime.finish_start()
            self.runtime.launch_locked()
            self.record("verifying-target")
            self.verify()
            self.record("activated")
        except Exception as error:
            self.record("checking-recovery", error=str(error))
            self.recover_trial()

    def recover_trial(self):
        runtime, state = self.runtime, self.state()
        before = json.loads((self.directory / "before/counts.json").read_text())
        owners = runtime.owned(state["release"], required=False)
        if owners[0]:
            self.freeze(state["release"], "recovery")
        try:
            # Read while admission is frozen, then again after all writers have exited.
            if runtime.active() or runtime.counts()["sequence"] != before["sequence"]:
                self.unfreeze()
                self.record("recovering-target", frozenBackend=None,
                            reason="The target accepted work or history. Preserve its data and runtime.")
                self.retain_target()
                return
            self.record("stopping-target-for-recovery", trialOwners=owners)
            runtime.stop_owned(state["release"], owners)
            if runtime.active() or runtime.counts()["sequence"] != before["sequence"]:
                self.record("recovering-target", frozenBackend=None,
                            reason="Stopped target data advanced. Preserve it and restart only the target.")
                self.retain_target()
                return
            self.record("restoring", frozenBackend=None)
            self.finish_restore()
        except BaseException:
            self.unfreeze()
            raise

    def retain_target(self):
        runtime, state = self.runtime, self.state()
        self.select(state["release"], state["revision"])
        if runtime.selected().get("startingDesktop"):
            try:
                runtime.finish_start()
            except TimeoutError:
                runtime.stop_owned(state["release"])
                self.select(state["release"], state["revision"])
        if not runtime.owned(state["release"], required=False)[0]:
            runtime.launch_locked()
        wait(lambda: self.ready(state["environmentId"], None), 180)
        self.record("recovery-required", reason="Newer target data preserved. Target is running for diagnosis.")

    def finish_restore(self):
        runtime, state = self.runtime, self.state()
        if runtime.owner(13873) or runtime.owner(5733):
            raise RuntimeError("A runtime writer is still present. Keep restoration launch-blocked.")
        # The durable restoring phase remains a launch barrier through every partial copy.
        runtime.restore(self.directory / "before")
        pointer = json.loads((self.directory / "before/pointer.json").read_text())
        pointer["installJournal"] = str(self.journal)
        atomic(runtime.pointer, pointer)
        self.record("starting-rollback")
        runtime.launch_locked()
        wait(lambda: self.ready(state["environmentId"], None), 180)
        self.record("rolled-back")

    def ready(self, environment_id, version):
        try:
            descriptor = self.runtime.http("/.well-known/t3/environment", authenticated=False)
            if descriptor["environmentId"] != environment_id:
                raise RuntimeError("The environment identity changed.")
            if version and descriptor["serverVersion"] != version:
                raise RuntimeError("The selected release version is not running.")
            capabilities = self.runtime.http("/api/executions/capabilities")
            return capabilities["environmentId"] == environment_id
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            return False

    def verify(self):
        state, runtime = self.state(), self.runtime
        wait(lambda: self.ready(state["environmentId"], state["version"]), 240)
        descriptor = runtime.http("/.well-known/t3/environment", authenticated=False)
        if descriptor["databaseMigration"] != state["migration"] or descriptor["capabilities"]["scheduledTaskOwner"] != "mation":
            raise RuntimeError("Migration or Mation ownership does not match the validated target.")
        if descriptor["capabilities"]["scheduledTaskThreadModes"] is not False:
            raise RuntimeError("The target advertised unsupported Mation thread modes.")
        owners = runtime.owned(state["release"])
        for path, expected in json.loads((self.directory / "artifact-hashes.json").read_text()).items():
            if digest(Path(state["release"]) / path) != expected:
                raise RuntimeError("The running build differs from the staged artifacts.")
        before = json.loads((self.directory / "before/counts.json").read_text())
        after = runtime.counts()
        if any(after[key] < before[key] for key in ["sequence", "orchestration_events",
                "orchestration_v2_projection_threads", "orchestration_v2_projection_messages"]):
            raise RuntimeError("Stored history decreased during the update.")
        with runtime.connection() as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("The live database failed quick_check.")
        if not runtime.http("/api/mation/page")["html"] or not runtime.http("/api/todo/page")["html"]:
            raise RuntimeError("A custom application bridge did not load.")
        if runtime.http("/api/todo/request", {"path": "todos", "method": "GET"}, "POST")["status"] != 200:
            raise RuntimeError("The Todo bridge could not read existing todos.")
        atomic(self.directory / "verification.json", {"revision": state["revision"], "descriptor": descriptor,
            "owners": owners, "before": before, "after": after, "quickCheck": "ok", "at": time.time()})
        pointer = runtime.selected()
        pointer.update(backendRevision=state["revision"], clientRevision=state["revision"],
                       desktopRevision=state["revision"], weeklyV018Receipt=str(self.directory / "verification.json"))
        atomic(runtime.pointer, pointer)

    def resume_locked(self):
        phase = self.state()["phase"]
        if phase == "quiescing":
            self.unfreeze()
            if self.state().get("quiescePurpose") == "recovery":
                self.record("checking-recovery", frozenBackend=None)
                self.recover_trial()
            else:
                self.record("waiting-for-idle", frozenBackend=None)
        elif phase == "stopping":
            self.runtime.stop_owned(self.state()["oldRelease"], self.state()["oldOwners"])
            self.record("backing-up", frozenBackend=None)
            self.finish_backup_and_switch()
        elif phase == "backing-up":
            self.finish_backup_and_switch()
        elif phase == "switching":
            self.select(self.state()["release"], self.state()["revision"])
            self.record("starting-target")
            self.start_and_verify()
        elif phase in {"starting-target", "verifying-target"}:
            self.start_and_verify()
        elif phase == "checking-recovery":
            self.recover_trial()
        elif phase == "stopping-target-for-recovery":
            state = self.state()
            self.runtime.stop_owned(state["release"], state["trialOwners"])
            before = json.loads((self.directory / "before/counts.json").read_text())
            if self.runtime.active() or self.runtime.counts()["sequence"] != before["sequence"]:
                self.record("recovering-target", frozenBackend=None, reason="Stopped target data advanced.")
                self.retain_target()
            else:
                self.record("restoring", frozenBackend=None)
                self.finish_restore()
        elif phase == "recovering-target":
            self.retain_target()
        elif phase in {"restoring", "starting-rollback"}:
            if phase == "restoring":
                self.finish_restore()
            else:
                self.runtime.launch_locked()
                wait(lambda: self.ready(self.state()["environmentId"], None), 180)
                self.record("rolled-back")

    def notify(self):
        state = self.state()
        wake = state["wake"]
        lookup = urllib.parse.urlencode({"projectId": wake["payload"]["target"]["projectId"],
                                       "threadId": wake["payload"]["threadId"],
                                       "messageId": wake["payload"]["messageId"]})
        path = "/api/executions/" + wake["commandId"]
        try:
            result = self.runtime.http(path + "?" + lookup)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            result = self.runtime.http(path, wake["payload"], "PUT")
        self.record(self.state()["phase"], continuation=result.get("ref"),
                    continuationStatus=result.get("status"), continuationDelivered=True)

    def run(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        if self.state()["phase"] in {"prepared", "waiting-for-idle"} and not self.state().get("bootstrapComplete"):
            raise RuntimeError("Finish the guarded launcher bootstrap before enabling activation.")
        with (self.directory / "controller.lock").open("a") as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            deadline = time.monotonic() + 24 * 3600
            while self.state()["phase"] not in TERMINAL:
                try:
                    phase = self.state()["phase"]
                    if phase in {"prepared", "waiting-for-idle"}:
                        if self.runtime.active():
                            if phase != "waiting-for-idle":
                                self.record("waiting-for-idle")
                            time.sleep(30)
                            continue
                        with (self.runtime.runtime / "client-install.lock").open("a") as lock:
                            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            with self.runtime.gate():
                                self.guards()
                                self.cutover()
                    else:
                        with (self.runtime.runtime / "client-install.lock").open("a") as lock:
                            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            with self.runtime.gate(recovery=True):
                                self.resume_locked()
                except Exception as error:
                    self.unfreeze()
                    self.record(self.state()["phase"], controllerError=str(error))
                    time.sleep(30)
                if time.monotonic() >= deadline and self.state()["phase"] in {"prepared", "waiting-for-idle"}:
                    self.record("deferred", reason="No safe idle window was available within 24 hours.")
            delay = 5
            while not self.state().get("continuationDelivered"):
                try:
                    self.notify()
                except Exception as error:
                    self.record(self.state()["phase"], continuationError=str(error))
                    time.sleep(delay)
                    delay = min(delay * 2, 60)


if __name__ == "__main__":
    installer = Installer(load_runtime(sys.argv[1]), sys.argv[2])
    if sys.argv[3:] == ["bootstrap"]:
        with (installer.runtime.runtime / "client-install.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            installer.bootstrap(Path(sys.argv[1]))
    else:
        installer.run()
