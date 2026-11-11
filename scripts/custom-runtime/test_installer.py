import contextlib
import io
import json
import multiprocessing
import os
from pathlib import Path
import plistlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import custom_runtime
from custom_runtime import Runtime, atomic
from installer import Installer


def queued_launch(config, ready, output):
    runtime = Runtime(config)
    runtime.launch_locked = lambda *args: Path(output).write_text(runtime.selected()["release"])
    ready.set()
    try:
        runtime.launch()
    except RuntimeError as error:
        Path(output).write_text(str(error))


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="custom-installer-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        config = {"primary": str(self.root / "primary"), "home": str(self.root / "home"),
                  "launcher": str(self.root / "launch.py"), "profile": str(self.root / "profile"),
                  "environment": {}}
        self.runtime = Runtime(config)
        self.runtime.db.parent.mkdir(parents=True)
        self.runtime.lock.parent.mkdir(parents=True)
        with sqlite3.connect(self.runtime.db) as db:
            db.executescript("""
                CREATE TABLE orchestration_events(sequence INTEGER PRIMARY KEY);
                INSERT INTO orchestration_events VALUES(42);
                CREATE TABLE orchestration_v2_projection_runs(run_id TEXT,thread_id TEXT,status TEXT);
                CREATE TABLE orchestration_v2_projection_threads(id TEXT);
                CREATE TABLE orchestration_v2_projection_messages(id TEXT);
                CREATE TABLE effect_sql_migrations(migration_id INTEGER);
                INSERT INTO effect_sql_migrations VALUES(76);
            """)
        atomic(self.runtime.pointer, {"release": "old", "revision": "old-revision"})
        self.directory = self.root / "attempt"
        self.directory.mkdir()
        self.installer = Installer(self.runtime, self.directory)
        self.installer.ready = lambda *_args: True
        atomic(self.installer.journal, {"phase": "prepared", "oldRelease": "old", "release": "new",
               "revision": "new-revision", "environmentId": "environment", "wake": {
                   "commandId": "stable-command", "payload": {"threadId": "same-thread",
                   "messageId": "stable-message", "target": {"projectId": "same-project"}}}})
        self.runtime.selected = self.runtime.selected
        self.quiet = contextlib.redirect_stdout(io.StringIO())
        self.quiet.__enter__()
        self.addCleanup(self.quiet.__exit__, None, None, None)

    def backup(self):
        self.runtime.snapshot(self.directory / "before")
        atomic(self.directory / "before/counts.json", self.runtime.counts())
        atomic(self.directory / "before/pointer.json", self.runtime.selected())

    def test_newly_accepted_run_after_idle_observation_defers_shutdown(self):
        self.assertEqual(self.runtime.active(), [])
        owners = ({"pid": 101, "identity": "owned backend"}, None, None)
        self.runtime.owned = lambda *_args, **_kwargs: owners
        def pause(pid, sig):
            if sig == signal.SIGSTOP:
                with sqlite3.connect(self.runtime.db) as db:
                    db.execute("INSERT INTO orchestration_v2_projection_runs VALUES('late','thread','running')")
        with patch("installer.process", return_value="owned backend"), patch("installer.suspended", return_value=True), \
             patch("installer.os.kill", side_effect=pause) as killed, \
             patch.object(self.runtime, "stop_owned") as stopped:
            self.assertFalse(self.installer.cutover())
        self.assertEqual(self.installer.state()["phase"], "waiting-for-idle")
        self.assertEqual(len(self.runtime.active()), 1)
        stopped.assert_not_called()
        self.assertEqual([call.args[1] for call in killed.call_args_list], [signal.SIGSTOP, signal.SIGCONT])

    def test_history_committed_during_shutdown_is_never_replaced(self):
        self.backup()
        atomic(self.runtime.pointer, {"release": "new", "revision": "new-revision"})
        self.runtime.owned = lambda *_args, **_kwargs: (None, None, None)
        def stop(*args):
            with sqlite3.connect(self.runtime.db) as db:
                db.execute("INSERT INTO orchestration_events VALUES(43)")
        self.runtime.stop_owned = stop
        with patch.object(self.runtime, "restore") as restored, patch.object(self.runtime, "launch_locked") as launched:
            self.installer.recover_trial()
        self.assertEqual(self.installer.state()["phase"], "recovery-required")
        self.assertEqual(self.runtime.counts()["sequence"], 43)
        restored.assert_not_called()
        launched.assert_called_once()

    def test_already_accepted_history_keeps_running_target(self):
        self.backup()
        with sqlite3.connect(self.runtime.db) as db:
            db.execute("INSERT INTO orchestration_events VALUES(43)")
        self.runtime.owned = lambda *_args, **_kwargs: (None, None, None)
        with patch.object(self.runtime, "stop_owned") as stopped, patch.object(self.runtime, "launch_locked"):
            self.installer.recover_trial()
        self.assertEqual(self.installer.state()["phase"], "recovery-required")
        stopped.assert_not_called()

    def test_retained_history_retries_failed_start_without_rollback_or_new_wake(self):
        self.backup()
        with sqlite3.connect(self.runtime.db) as db:
            db.execute("INSERT INTO orchestration_events VALUES(43)")
        self.runtime.owned = lambda *_args, **_kwargs: (None, None, None)
        with patch.object(self.runtime, "launch_locked", side_effect=[OSError("Temporary start failure"), None]) as started, \
             patch.object(self.runtime, "restore") as restored:
            with self.assertRaisesRegex(OSError, "Temporary"):
                self.installer.recover_trial()
            self.assertEqual(self.installer.state()["phase"], "recovering-target")
            self.installer.resume_locked()
        self.assertEqual(started.call_count, 2)
        restored.assert_not_called()
        self.assertEqual(self.runtime.counts()["sequence"], 43)
        self.assertEqual(self.runtime.selected()["release"], "new")
        self.assertEqual(self.installer.state()["phase"], "recovery-required")
        self.runtime.assert_launchable()

    def test_bootstrap_drains_spaced_and_unquoted_legacy_launcher_paths(self):
        self.runtime.launcher = self.root / "T3 Code Custom.app/Contents/Resources/launch.py"
        self.runtime.launcher.parent.mkdir(parents=True)
        old_url = "old/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher"
        commands = f"321 /python {self.runtime.launcher}\n322 /bin/sh {old_url}\n"
        alive = {321, 322}
        def external(args, **kwargs):
            return commands if str(args[0]) == "/bin/ps" else ""
        def drain(check, seconds):
            self.assertFalse(self.installer.state().get("bootstrapComplete", False))
            self.assertFalse(check())
            alive.remove(min(alive))
            self.assertTrue(check())
        self.runtime.owned = lambda *_args, **_kwargs: (None, None, {"pid": 1})
        with patch("installer.run", side_effect=external), \
             patch("installer.process", side_effect=lambda pid: "old launcher" if pid in alive else None), \
             patch("installer.wait", side_effect=drain), patch.object(self.runtime, "prepare_bundle"):
            self.installer.bootstrap(self.root / "config.json")
        self.assertEqual([item["pid"] for item in self.installer.state()["legacyLaunchers"]], [321, 322])
        self.assertTrue(self.installer.state()["bootstrapComplete"])

    def test_bundle_registration_failure_never_exposes_a_direct_launcher(self):
        old, target = self.root / "old", self.root / "target"
        old_bundle = old / "apps/desktop/.electron-runtime/T3 Code (Dev).app"
        base = target / "apps/desktop/node_modules/electron/dist/Electron.app"
        for bundle in [old_bundle, base]:
            (bundle / "Contents/Resources").mkdir(parents=True)
            (bundle / "Contents/MacOS").mkdir()
            with (bundle / "Contents/Info.plist").open("wb") as output:
                plistlib.dump({"CFBundleIdentifier": "custom.installation", "CFBundleExecutable": "Electron"}, output)
            for icon in ["icon.icns", "electron.icns"]:
                (bundle / "Contents/Resources" / icon).write_bytes(b"fixture icon")
        real_run = custom_runtime.run
        guarded = target / "apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher"
        def external(args, **kwargs):
            if str(args[0]).endswith("lsregister"):
                self.assertEqual(guarded.read_text(), self.runtime.protocol_script())
                raise OSError("Injected registration interruption")
            if str(args[0]) == "/usr/bin/codesign":
                self.assertEqual(guarded.read_text(), self.runtime.protocol_script())
                return ""
            return real_run(args, **kwargs)
        with patch("custom_runtime.run", side_effect=external):
            with self.assertRaisesRegex(OSError, "Injected"):
                self.runtime.prepare_bundle(target, old)
        self.assertEqual(guarded.read_text(), self.runtime.protocol_script())
        self.assertNotIn("exec 'Electron'", guarded.read_text())

    def test_child_executes_only_after_its_start_identity_is_durable(self):
        release = self.root / "release"
        (release / "apps/desktop").mkdir(parents=True)
        output = self.root / "child-result"
        command = [sys.executable, "-c", "import os,json,pathlib; p=json.loads(pathlib.Path(" +
                   repr(str(self.runtime.pointer)) + ").read_text()); assert p['startingDesktop']['pid']==os.getpid(); " +
                   "pathlib.Path(" + repr(str(output)) + ").write_text('started after journal')"]
        child = self.runtime.spawn_desktop(command, release, os.environ.copy())
        self.assertEqual(child.wait(10), 0)
        self.assertEqual(output.read_text(), "started after journal")

    def test_child_exits_without_starting_if_journal_write_is_interrupted(self):
        release = self.root / "release"
        (release / "apps/desktop").mkdir(parents=True)
        output = self.root / "must-not-exist"
        command = [sys.executable, "-c", "from pathlib import Path; Path(" + repr(str(output)) + ").touch()"]
        children = []
        real_popen = subprocess.Popen
        def spawn(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            return child
        with patch("custom_runtime.atomic", side_effect=OSError("Journal interrupted")), \
             patch("custom_runtime.subprocess.Popen", side_effect=spawn):
            with self.assertRaisesRegex(OSError, "Journal interrupted"):
                self.runtime.spawn_desktop(command, release, os.environ.copy())
        self.assertEqual(children[0].wait(10), 0)
        self.assertFalse(output.exists())

    def test_real_backend_pause_keeps_a_wal_commit_stable_until_resume(self):
        code = """import sqlite3,sys
db=sqlite3.connect(sys.argv[1]); db.execute('PRAGMA journal_mode=WAL'); print('ready',flush=True)
for message in sys.stdin:
 if message.strip()=='stop': break
 db.execute("INSERT INTO orchestration_v2_projection_runs VALUES('accepted','thread','running')")
 db.commit(); print('accepted',flush=True)
"""
        child = subprocess.Popen([sys.executable, "-u", "-c", code, str(self.runtime.db)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.addCleanup(lambda: child.kill() if child.poll() is None else None)
        self.addCleanup(child.stdout.close)
        self.addCleanup(child.stdin.close)
        self.assertEqual(child.stdout.readline().strip(), "ready")
        self.assertEqual(self.runtime.active(), [])
        child.stdin.write("accept\n"); child.stdin.flush()
        self.assertEqual(child.stdout.readline().strip(), "accepted")
        backend = {"pid": child.pid, "identity": custom_runtime.process(child.pid)}
        self.runtime.owned = lambda *_args, **_kwargs: (backend, None, None)
        try:
            self.installer.freeze("old")
            self.assertTrue(custom_runtime.suspended(child.pid))
            self.assertEqual(len(self.runtime.active()), 1)
            child.stdin.write("accept\n"); child.stdin.flush()
            self.assertEqual(len(self.runtime.active()), 1)
        finally:
            self.installer.unfreeze()
        self.assertEqual(child.stdout.readline().strip(), "accepted")
        self.assertEqual(len(self.runtime.active()), 2)
        child.stdin.write("stop\n"); child.stdin.flush()
        self.assertEqual(child.wait(10), 0)

    def exercise_interrupted_restore_through_controller(self, interrupted_index):
        self.runtime.profile.mkdir()
        (self.runtime.profile / "Preferences").write_text("original profile")
        connection = sqlite3.connect(self.runtime.db)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("INSERT INTO orchestration_events VALUES(43)")
        connection.commit()
        self.backup()
        connection.close()
        with sqlite3.connect(self.runtime.db) as candidate:
            candidate.execute("INSERT INTO orchestration_events VALUES(44)")
        (self.runtime.profile / "Preferences").write_text("trial profile")
        self.installer.record("restoring")
        atomic(self.runtime.pointer, {"release": "new", "revision": "new-revision",
                                     "installJournal": str(self.installer.journal)})
        real_clone = custom_runtime.clone
        def interrupt(source, destination):
            if str(source) == str(self.directory / "before" / str(interrupted_index)):
                raise OSError("Injected partial WAL or profile restore")
            return real_clone(source, destination)
        with patch("custom_runtime.clone", side_effect=interrupt):
            with self.assertRaisesRegex(OSError, "Injected"):
                self.runtime.restore(self.directory / "before")
        with self.assertRaisesRegex(RuntimeError, "recovery must finish"):
            self.runtime.launch()
        self.runtime.owner = lambda _port: None
        self.runtime.http = lambda *_args: {"ref": {"threadId": "same-thread"}, "status": "running"}
        with patch.object(self.runtime, "launch_locked") as launched:
            self.installer.run()
        self.assertEqual(self.installer.state()["phase"], "rolled-back")
        self.assertTrue(self.installer.state()["continuationDelivered"])
        self.assertEqual(self.runtime.counts()["sequence"], 43)
        self.assertEqual((self.runtime.profile / "Preferences").read_text(), "original profile")
        launched.assert_called_once()

    def test_interrupted_wal_restore_resumes_through_controller(self):
        self.exercise_interrupted_restore_through_controller(1)

    def test_interrupted_profile_restore_resumes_through_controller(self):
        self.exercise_interrupted_restore_through_controller(8)

    def test_queued_launcher_reads_selection_only_after_real_lock(self):
        context = multiprocessing.get_context("spawn")
        ready = context.Event()
        output = self.root / "launch-result"
        with self.runtime.gate():
            child = context.Process(target=queued_launch, args=(self.runtime.config, ready, output))
            child.start()
            self.assertTrue(ready.wait(5))
            self.assertFalse(output.exists())
            atomic(self.runtime.pointer, {"release": "new", "revision": "new-revision"})
        child.join(10)
        if child.is_alive():
            child.terminate()
            child.join()
            self.fail("Fixture launcher did not leave the real lock.")
        self.assertEqual(child.exitcode, 0)
        self.assertEqual(output.read_text(), "new")

    def test_interrupted_restore_blocks_launch_and_resumes_original_absence(self):
        settings = self.runtime.home / "userdata/settings.json"
        self.assertFalse(settings.exists())
        self.backup()
        settings.write_text("trial settings")
        self.runtime.profile.mkdir()
        (self.runtime.profile / "trial").write_text("trial profile")
        self.installer.record("restoring")
        atomic(self.runtime.pointer, {"release": "new", "revision": "new-revision",
                                     "installJournal": str(self.installer.journal)})
        real_clone = custom_runtime.clone
        failed = False
        def interrupt(source, destination):
            nonlocal failed
            if not failed and str(destination).endswith(".restore-tmp"):
                failed = True
                raise OSError("Injected interrupted database clone")
            return real_clone(source, destination)
        with patch("custom_runtime.clone", side_effect=interrupt):
            with self.assertRaisesRegex(OSError, "Injected"):
                self.runtime.restore(self.directory / "before")
        self.assertFalse(self.runtime.db.exists())
        with self.assertRaisesRegex(RuntimeError, "recovery must finish"):
            self.runtime.launch()
        self.assertFalse(self.runtime.db.exists(), "A refused launch must never create an empty database.")
        resumed = Runtime(self.runtime.config)
        resumed.restore(self.directory / "before")
        self.assertEqual(resumed.counts()["sequence"], 42)
        self.assertFalse(settings.exists())
        self.assertFalse(resumed.profile.exists())
        self.assertEqual((self.directory / "failed-data/3").read_text(), "trial settings")

    def test_restore_reentry_after_rename_before_journal_commit(self):
        self.backup()
        real_atomic = custom_runtime.atomic
        failed = False
        def interrupt(path, value):
            nonlocal failed
            if Path(path).name == "restore-progress.json" and not failed:
                failed = True
                raise OSError("Injected journal write interruption")
            return real_atomic(path, value)
        with patch("custom_runtime.atomic", side_effect=interrupt):
            with self.assertRaisesRegex(OSError, "Injected"):
                self.runtime.restore(self.directory / "before")
        self.runtime.restore(self.directory / "before")
        self.assertEqual(self.runtime.counts()["sequence"], 42)

    def test_recovery_quiescence_reentry_does_not_attempt_old_cutover(self):
        self.installer.record("quiescing", quiescePurpose="recovery")
        with patch.object(self.installer, "recover_trial") as recovered:
            self.installer.resume_locked()
        recovered.assert_called_once()
        self.assertEqual(self.installer.state()["phase"], "checking-recovery")

    def test_incomplete_start_is_recovered_without_a_second_desktop(self):
        atomic(self.runtime.pointer, {"release": "new", "revision": "new-revision",
                                     "startingDesktop": {"pid": 123, "release": "new"}})
        with patch.object(self.runtime, "finish_start", side_effect=TimeoutError("Startup failed")), \
             patch.object(self.runtime, "launch_locked") as launched, \
             patch.object(self.installer, "recover_trial") as recovered:
            self.installer.start_and_verify()
        launched.assert_not_called()
        recovered.assert_called_once()

    def test_outage_and_lost_put_response_deliver_exactly_one_same_chat_wake(self):
        self.installer.record("activated")
        requests, accepted = [], {}
        outages = 2
        def http(path, body=None, method=None):
            nonlocal outages
            requests.append((path, body, method))
            if outages:
                outages -= 1
                raise ConnectionError("Recoverable backend outage")
            if method == "PUT":
                accepted[path] = body
                raise TimeoutError("Accepted PUT response lost")
            key = path.split("?")[0]
            if key not in accepted:
                raise urllib.error.HTTPError(path, 404, "not found", {}, None)
            return {"ref": {"threadId": "same-thread"}, "status": "running"}
        self.runtime.http = http
        with patch("installer.time.sleep"):
            self.installer.run()
        self.assertTrue(self.installer.state()["continuationDelivered"])
        self.assertEqual(len(accepted), 1)
        self.assertEqual(next(iter(accepted.values()))["threadId"], "same-thread")
        self.assertEqual(next(iter(accepted.values()))["messageId"], "stable-message")
        self.assertEqual(sum(method == "PUT" for _, _, method in requests), 1)


if __name__ == "__main__":
    unittest.main()
