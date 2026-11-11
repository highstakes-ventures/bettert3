"""Start Joseph's existing custom installation through one durable launch gate."""

import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as output:
        os.chmod(temporary, 0o600)
        output.write(json.dumps(value, indent=2) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    sync_directory(path.parent)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run(args, **kwargs):
    result = subprocess.run(list(map(str, args)), capture_output=True, text=True,
                            timeout=kwargs.pop("timeout", 180), **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr[-800:]}")
    return result.stdout


def digest(path):
    with Path(path).open("rb") as source:
        result = hashlib.file_digest(source, "sha256") if hasattr(hashlib, "file_digest") else None
        if result is not None:
            return result.hexdigest()
        result = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
        return result.hexdigest()


def clone(source, destination):
    source, destination = Path(source), Path(destination)
    if destination.exists():
        raise RuntimeError(f"Refusing to overwrite {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    run(["/bin/cp", "-cR", source, destination], timeout=900)
    for item in ([destination] if destination.is_file() else
                 [path for path in destination.rglob("*") if path.is_file() and not path.is_symlink()]):
        with item.open("rb") as copied:
            os.fsync(copied.fileno())
    sync_directory(destination.parent)


def wait(check, seconds=120):
    deadline = time.monotonic() + seconds
    while True:
        result = check()
        if result:
            return result
        if time.monotonic() >= deadline:
            raise TimeoutError("The owned runtime did not complete its transition.")
        time.sleep(1)


def process(pid):
    result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart=,args="],
                            capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def suspended(pid):
    return "T" in run(["/bin/ps", "-p", pid, "-o", "stat="])


class Runtime:
    def __init__(self, config):
        self.config = config
        self.primary = Path(config["primary"])
        self.runtime = self.primary / ".local-runtime"
        self.pointer = self.runtime / "current.json"
        self.home = Path(config["home"])
        self.db = self.home / "userdata/statev2.sqlite"
        self.launcher = Path(config["launcher"])
        self.profile = Path(config["profile"])
        self.lock = self.runtime / "probe/spotlight-launch.lock"

    def selected(self):
        return json.loads(self.pointer.read_text())

    @contextlib.contextmanager
    def gate(self, recovery=False):
        self.lock.parent.mkdir(parents=True, exist_ok=True)
        with self.lock.open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if not recovery:
                self.finish_start()
            yield

    def owner(self, port):
        result = subprocess.run(["/usr/sbin/lsof", "-nP", f"-iTCP:{port}",
                                 "-sTCP:LISTEN", "-t"], capture_output=True, text=True)
        ids = set(result.stdout.split())
        if not ids:
            return None
        if len(ids) != 1:
            raise RuntimeError(f"Expected one listener on port {port}.")
        pid = int(ids.pop())
        cwd = next(line[1:] for line in run(["/usr/sbin/lsof", "-a", "-p", pid,
                                             "-d", "cwd", "-Fn"]).splitlines()
                   if line.startswith("n"))
        return {"pid": pid, "cwd": cwd, "identity": process(pid),
                "parent": int(run(["/bin/ps", "-p", pid, "-o", "ppid="]).strip())}

    def owned(self, release, required=True):
        release = str(release)
        backend, frontend = self.owner(13873), self.owner(5733)
        if backend:
            if backend["cwd"] != release or release + "/apps/server/dist/bin.mjs" not in backend["identity"]:
                raise RuntimeError("The backend listener belongs to another installation.")
            desktop = {"pid": backend["parent"], "identity": process(backend["parent"])}
            if not desktop["identity"] or release not in desktop["identity"]:
                raise RuntimeError("The backend parent belongs to another installation.")
        else:
            desktop = self.selected().get("startingDesktop")
            if desktop:
                current = process(desktop["pid"])
                if (desktop["release"] != release or not current or release not in current or
                        current[:24] != desktop["identity"][:24]):
                    desktop = None
                else:
                    desktop = {**desktop, "identity": current}
        if frontend and frontend["cwd"] != release + "/apps/web":
            raise RuntimeError("The frontend listener belongs to another installation.")
        if required and (not backend or not frontend or not desktop):
            raise RuntimeError("The selected custom installation is not fully running.")
        return backend, frontend, desktop

    def finish_start(self):
        state = self.selected()
        starting = state.get("startingDesktop")
        if not starting:
            return
        def finished():
            identity = process(starting["pid"])
            if not identity or identity[:24] != starting["identity"][:24]:
                return True
            backend = self.owner(13873)
            return bool(backend and backend["cwd"] == starting["release"] and
                        backend["parent"] == starting["pid"])
        wait(finished, 180)
        state = self.selected()
        state.pop("startingDesktop", None)
        atomic(self.pointer, state)

    def assert_launchable(self):
        journal = self.selected().get("installJournal")
        if journal:
            state = json.loads(Path(journal).read_text())
            if state["phase"] not in {"prepared", "waiting-for-idle", "activated", "rolled-back", "deferred", "recovery-required"}:
                raise RuntimeError(f"Installation recovery must finish before launch: {journal}")

    def launch(self, arguments=(), protocol=False):
        with self.gate():
            self.assert_launchable()
            self.launch_locked(arguments, protocol)

    def environment(self, revision):
        env = os.environ.copy()
        for name in ["ELECTRON_RUN_AS_NODE", "T3_SERVICE_LAUNCHER_CONTEXT", "T3_BOOT_SERVICE_UNIT",
                     "T3CODE_DEV_AUTH_TOKEN", "VITE_HTTP_URL", "VITE_WS_URL", "T3CODE_MODE",
                     "T3CODE_DESKTOP_WS_URL"]:
            env.pop(name, None)
        env.update(PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                   T3CODE_HOME=str(self.home), T3CODE_PORT="13873",
                   VITE_DEV_SERVER_URL="http://localhost:5733", T3CODE_COMMIT_HASH=revision,
                   T3CODE_DISABLE_AUTO_UPDATE="1", NODE_OPTIONS="--use-system-ca",
                   T3CODE_SINGLE_ORIGIN_DEV="1", ELECTRON_ENABLE_LOGGING="1")
        env.update(self.config["environment"])
        return env

    def protocol_wrapper(self, executable):
        content = self.protocol_script()
        temporary = executable.with_name(executable.name + ".tmp")
        with temporary.open("w") as output:
            os.fchmod(output.fileno(), 0o755)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, executable)
        sync_directory(executable.parent)
        bundle = executable.parents[2]
        run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", "--timestamp=none", bundle])

    def protocol_script(self):
        return ("#!/bin/sh\nexec /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 "
                + shlex.quote(str(self.launcher)) + ' --protocol "$@"\n')

    def prepare_bundle(self, release, old_release):
        release, old_release = Path(release), Path(old_release)
        bundle = release / "apps/desktop/.electron-runtime/T3 Code (Dev).app"
        old_bundle = old_release / "apps/desktop/.electron-runtime/T3 Code (Dev).app"
        executable = bundle / "Contents/MacOS/T3 Code (Dev) Launcher"
        if not bundle.exists():
            temporary = bundle.with_name(bundle.name + ".preparing")
            if temporary.exists():
                shutil.rmtree(temporary)
            clone(release / "apps/desktop/node_modules/electron/dist/Electron.app", temporary)
            plist_path = temporary / "Contents/Info.plist"
            with plist_path.open("rb") as source:
                plist = plistlib.load(source)
            with (old_bundle / "Contents/Info.plist").open("rb") as source:
                old_plist = plistlib.load(source)
            bundle_id = old_plist["CFBundleIdentifier"]
            plist.update(CFBundleDisplayName="T3 Code (Dev)", CFBundleName="T3 Code (Dev)",
                CFBundleIdentifier=bundle_id, CFBundleExecutable="T3 Code (Dev) Launcher",
                CFBundleURLTypes=[{"CFBundleURLName": bundle_id, "CFBundleURLSchemes": ["t3code-dev"]}],
                CFBundleIconFile="icon.icns", NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac=True)
            for key in ["NSScreenCaptureUsageDescription", "NSDocumentsFolderUsageDescription"]:
                if key in old_plist:
                    plist[key] = old_plist[key]
            with plist_path.open("wb") as output:
                plistlib.dump(plist, output)
            for icon in ["icon.icns", "electron.icns"]:
                shutil.copy2(old_bundle / "Contents/Resources" / icon, temporary / "Contents/Resources" / icon)
            for suffix, name in [("", "helper"), (" (GPU)", "helper.gpu"),
                                 (" (Plugin)", "helper.plugin"), (" (Renderer)", "helper.renderer")]:
                helper = temporary / f"Contents/Frameworks/Electron Helper{suffix}.app/Contents/Info.plist"
                if helper.exists():
                    with helper.open("rb") as source:
                        values = plistlib.load(source)
                    values.update(CFBundleIdentifier=bundle_id + "." + name,
                                  CFBundleName="T3 Code (Dev) Helper" + suffix,
                                  CFBundleDisplayName="T3 Code (Dev) Helper" + suffix)
                    with helper.open("wb") as output:
                        plistlib.dump(values, output)
            (temporary / "Contents/MacOS/T3 Code (Dev) Launcher").write_text(self.protocol_script())
            (temporary / "Contents/MacOS/T3 Code (Dev) Launcher").chmod(0o755)
            os.replace(temporary, bundle)
            sync_directory(bundle.parent)
        self.protocol_wrapper(executable)
        # Registration happens only after the guarded executable is durable and signed.
        run(["/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
             "-f", bundle])
        return bundle

    def launch_locked(self, arguments=(), protocol=False):
        state = self.selected()
        release = Path(state["release"])
        env = self.environment(state["revision"])
        for alias, target in [(Path("/private/tmp/t3-cloud-sidebar-20261015"), self.primary),
                              (Path("/private/tmp/t3-sections-desktop-20261015"), self.runtime / "frontend"),
                              (Path("/private/tmp/t3-cloud-probe"), self.runtime / "probe")]:
            if alias.exists() or alias.is_symlink():
                if alias.resolve() != target.resolve():
                    raise RuntimeError(f"Legacy alias belongs to another directory: {alias}")
            else:
                alias.symlink_to(target, target_is_directory=True)
        frontend = self.owner(5733)
        if frontend and frontend["cwd"] != str(release / "apps/web"):
            raise RuntimeError("Port 5733 belongs to another runtime.")
        if not frontend:
            with (self.runtime / "probe/spotlight-renderer.log").open("ab") as log:
                child = subprocess.Popen(["/opt/homebrew/bin/node", str(release / "node_modules/vite-plus/bin/vp"),
                                          "preview", "--config", str(release / "runtime/vite-preview.config.mjs"),
                                          "--host", "localhost", "--port", "5733", "--strictPort"],
                                         cwd=release / "apps/web", env=env, stdout=log,
                                         stderr=subprocess.STDOUT, start_new_session=True)
            wait(lambda: self.owner(5733) if child.poll() is None else
                 (_ for _ in ()).throw(RuntimeError("The custom frontend exited.")), 60)
        executable = release / "apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher"
        if executable.read_text() != self.protocol_script():
            raise RuntimeError("The prepared Custom URL handler is not guarded.")
        with (executable.parents[1] / "Info.plist").open("rb") as source:
            env["T3CODE_DESKTOP_APP_USER_MODEL_ID"] = plistlib.load(source)["CFBundleIdentifier"]
        binary = executable.parent / "Electron"
        command = [str(binary), f"--t3code-dev-root={release / 'apps/desktop'}",
                   str(release / "apps/desktop/dist-electron/main.cjs"), *arguments]
        backend = self.owner(13873)
        if backend:
            self.owned(release)
            if arguments or protocol:
                # Keep LaunchServices' process identity so Electron receives the open-url event.
                state["startingDesktop"] = {"pid": os.getpid(), "identity": process(os.getpid()),
                                           "release": str(release)}
                atomic(self.pointer, state)
                os.execvpe(command[0], command, env)
            run(["/usr/bin/osascript", "-l", "JavaScript", "-e", 'ObjC.import("AppKit"); '
                 f'$.NSRunningApplication.runningApplicationWithProcessIdentifier({backend["parent"]}).activateWithOptions(3);'], env=env)
            return
        if protocol:
            pid = os.getpid()
            state["startingDesktop"] = {"pid": pid, "identity": process(pid), "release": str(release)}
            atomic(self.pointer, state)
            os.execvpe(command[0], command, env)
        self.spawn_desktop(command, release, env)
        self.finish_start()

    def spawn_desktop(self, command, release, env):
        read_fd, write_fd = os.pipe()
        try:
            with (self.runtime / "probe/desktop-preview-current.log").open("ab") as log:
                child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--spawn",
                                          str(read_fd), *command], cwd=release / "apps/desktop", env=env,
                                         stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                         pass_fds=(read_fd,))
            os.close(read_fd)
            read_fd = None
            state = self.selected()
            state["startingDesktop"] = {"pid": child.pid, "identity": process(child.pid), "release": str(release)}
            atomic(self.pointer, state)
            os.write(write_fd, b"S")
            return child
        finally:
            if read_fd is not None:
                os.close(read_fd)
            os.close(write_fd)

    def http(self, path, body=None, method=None, authenticated=True):
        headers = {}
        if authenticated:
            headers["Authorization"] = "Bearer " + Path(self.config["tokenFile"]).read_text().strip()
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request("http://127.0.0.1:13873" + path,
            data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())

    @contextlib.contextmanager
    def connection(self):
        connection = sqlite3.connect(self.db.as_uri() + "?mode=ro", uri=True, timeout=5)
        try:
            yield connection
        finally:
            connection.close()

    def active(self):
        with self.connection() as db:
            return db.execute("SELECT run_id,thread_id,status FROM orchestration_v2_projection_runs "
                              "WHERE status IN ('preparing','queued','starting','running','waiting')").fetchall()

    def counts(self):
        with self.connection() as db:
            result = {table: db.execute("SELECT count(*) FROM " + table).fetchone()[0]
                      for table in ["orchestration_events", "orchestration_v2_projection_threads",
                                    "orchestration_v2_projection_messages"]}
            result["sequence"] = db.execute("SELECT coalesce(max(sequence),0) FROM orchestration_events").fetchone()[0]
            result["migration"] = db.execute("SELECT max(migration_id) FROM effect_sql_migrations").fetchone()[0]
            return result

    def stop_owned(self, release, owners=None):
        backend, frontend, desktop = owners or self.owned(release, required=False)
        if backend and process(backend["pid"]) not in {None, backend["identity"]}:
            raise RuntimeError("Backend ownership changed before shutdown.")
        if desktop and process(desktop["pid"]):
            if process(desktop["pid"]) != desktop["identity"]:
                raise RuntimeError("Desktop ownership changed before shutdown.")
            os.kill(desktop["pid"], signal.SIGTERM)
            wait(lambda: not process(desktop["pid"]) and (not backend or not process(backend["pid"])), 120)
        elif backend and process(backend["pid"]) == backend["identity"]:
            os.kill(backend["pid"], signal.SIGKILL)
            wait(lambda: not process(backend["pid"]), 30)
        if frontend and process(frontend["pid"]):
            if process(frontend["pid"]) != frontend["identity"]:
                raise RuntimeError("Frontend ownership changed before shutdown.")
            os.kill(frontend["pid"], signal.SIGTERM)
            wait(lambda: not process(frontend["pid"]), 60)

    def managed_paths(self):
        paths = [Path(str(self.db) + suffix) for suffix in ["", "-wal", "-shm"]]
        paths += [self.home / "userdata" / name for name in
                  ["settings.json", "client-settings.json", "desktop-settings.json", "keybindings.json", "secrets"]]
        return paths + [self.profile]

    def snapshot(self, directory):
        directory.mkdir(mode=0o700, exist_ok=True)
        manifest = []
        for index, path in enumerate(self.managed_paths()):
            saved = directory / str(index)
            present = path.exists()
            if present:
                clone(path, saved)
            manifest.append({"path": str(path), "backup": str(saved), "present": present})
        atomic(directory / "manifest.json", manifest)
        return manifest

    def restore(self, directory):
        manifest = json.loads((directory / "manifest.json").read_text())
        quarantine = directory.parent / "failed-data"
        quarantine.mkdir(mode=0o700, exist_ok=True)
        completed_path = directory.parent / "restore-progress.json"
        completed = json.loads(completed_path.read_text()) if completed_path.exists() else []
        for index, entry in enumerate(manifest):
            if index in completed:
                continue
            destination = Path(entry["path"])
            preserved = quarantine / str(index)
            if destination.exists() and not preserved.exists():
                os.replace(destination, preserved)
                sync_directory(destination.parent)
            elif destination.exists():
                if destination.is_dir():
                    shutil.rmtree(destination)
                else:
                    destination.unlink()
            temporary = destination.with_name(destination.name + ".restore-tmp")
            if temporary.exists():
                shutil.rmtree(temporary) if temporary.is_dir() else temporary.unlink()
            if entry["present"]:
                clone(Path(entry["backup"]), temporary)
                os.replace(temporary, destination)
                sync_directory(destination.parent)
            completed.append(index)
            atomic(completed_path, completed)


def load_runtime(config_path):
    return Runtime(json.loads(Path(config_path).read_text()))


if __name__ == "__main__":
    if sys.argv[1:2] == ["--spawn"]:
        fd = int(sys.argv[2])
        admitted = os.read(fd, 1) == b"S"
        os.close(fd)
        if admitted:
            os.execvpe(sys.argv[3], sys.argv[3:], os.environ)
        sys.exit(0)
    runtime = load_runtime(sys.argv[1])
    arguments = sys.argv[2:]
    protocol = bool(arguments and arguments[0] == "--protocol")
    runtime.launch(arguments[1:] if protocol else arguments, protocol)
