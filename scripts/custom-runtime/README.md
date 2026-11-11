# Updating the custom desktop installation

This launcher is for the existing T3 Code Custom installation on Joseph's Mac.
It preserves its frontend origin, backend port, T3 home, Electron profile and
Mation/Todo configuration. Ordinary development launchers remain independent.

The installed copy lives under `.local-runtime/installer`. Its private
`config.json` names `primary`, `home`, `launcher`, `profile`, `tokenFile` and
`environment`. Store token file paths, never token values. `current.json` selects
the release and points to the active installation journal. Do not edit the
release selection while a controller owns the installation lock.

The Custom app and its registered `t3code-dev` launcher enter `custom_runtime.py`.
Release selection happens inside the existing `spotlight-launch.lock`. Protocol
starts keep their process identity for macOS link delivery and record an
incomplete start before executing Electron. The installer waits for that start
before changing versions. Bootstrap updates the entry points while the old
release remains selected and drains earlier launch invocations before enabling
cutover.

Prepare a matched, immutable custom build and a private attempt directory before
running the controller. Retain the prior release. The journal contains the old
and target releases, target `revision`, exact `publishedRevision`, source checkout,
environment identity and stable same-chat execution `wake`. Keep the target and
old artifact hash manifests beside it. The wake uses an existing project/thread
and one stable command/message identity, not a new conversation or schedule.

Run the installed controller with its configuration and attempt directory:

```sh
python3 installer.py /absolute/path/config.json /absolute/path/attempt bootstrap
python3 installer.py /absolute/path/config.json /absolute/path/attempt
```

The controller waits for every active run, including its owning chat, to finish.
Under the shared gate it pauses the verified backend before the final durable
idle decision. Busy work resumes unchanged. An idle backend stops through its
existing desktop owner. A fresh stopped-data backup covers SQLite, settings,
secrets and the Electron profile, including paths that were originally absent.
The target then starts through the same launcher and verifies its environment,
version, migrations, artifacts, history and custom bridges.

If the target fails, recovery stops its writers before the authoritative history
comparison. New accepted history prevents restoring the old snapshot. Otherwise,
a durable `restoring` phase blocks every guarded launch until a resumable restore
finishes. Re-running the same controller resumes its recorded phase and retains
the original backup and wake identities. Never restore a snapshot manually over
a running backend or start the old release against migrated target data.

Controller output and its durable PID belong in the attempt directory. Keep the
controller detached from the backend it replaces. Save the owning chat's durable
checkpoint before handing off. The controller retries the same-chat wake after
recoverable outages, including a successful submission whose response was lost.
A published build, open port or queued controller does not prove a live update.
The resumed owning chat must verify the actual app and affected workflows.

Run the harmless installer fixtures from this directory:

```sh
python3 -m unittest -v test_installer
```
