import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def _raise_keyboard_interrupt(signum, frame):
    raise KeyboardInterrupt


def _register_shutdown_handlers():
    for signal_name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        shutdown_signal = getattr(signal, signal_name, None)
        if shutdown_signal is not None:
            signal.signal(shutdown_signal, _raise_keyboard_interrupt)


def _start_process(command, cwd):
    kwargs = {"cwd": cwd}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(command, **kwargs)


def _stop_process_tree(process):
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def start_whole_app():
    # потом добавить старт дб, первым шагом (а надо ли?)
    _register_shutdown_handlers()
    npm_command = "npm.cmd" if os.name == "nt" else "npm"
    backend = _start_process([sys.executable, "-m", "uvicorn", "app.main:app", "--reload"], cwd=ROOT / "backend")
    frontend = _start_process([npm_command, "run", "dev"], cwd=ROOT / "frontend")
    try:
        while backend.poll() is None and frontend.poll() is None:
            time.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        _stop_process_tree(frontend)
        _stop_process_tree(backend)


def start_back_n_test(test_data=1):
    # как добавить аргумент test_data в backend
    _register_shutdown_handlers()
    subprocess.run(
            [
            sys.executable, "-m", "tests.integration_tests.back_pipeline_with_test_data",
            ],
        cwd=ROOT / "backend",check=False,
        )

def start_feedback_check():
    _register_shutdown_handlers()
    subprocess.run(
            [
            sys.executable, "-m", "tests.integration_tests.back_feedback_download",
            ],
        cwd=ROOT / "backend",check=False,
        )

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command" , help=" 'start_app' start front and back. 'start_e2e_back' - start only back with first test data with real provaider")

    args = parser.parse_args()
    if args.command == "start_app":
        start_whole_app()

    if args.command == "start_e2e_back":
        start_back_n_test()

    if args.command == "feedback_check":
        start_feedback_check()



if __name__ == "__main__":
    main()
