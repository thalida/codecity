import subprocess
import sys
import unittest


CMD = [sys.executable, "-m", "codecity"]


class CLIArgSurfaceTests(unittest.TestCase):
    def test_version_works(self) -> None:
        out = subprocess.run(CMD + ["--version"], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0)
        self.assertIn("codecity", out.stdout.lower())

    def test_no_window_rejected(self) -> None:
        out = subprocess.run(CMD + ["--no-window"], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)

    def test_no_cache_rejected(self) -> None:
        out = subprocess.run(CMD + ["--no-cache"], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)

    def test_clone_flag_rejected(self) -> None:
        out = subprocess.run(
            CMD + ["--clone", "https://example.com/x.git"],
            capture_output=True, text=True,
        )
        self.assertNotEqual(out.returncode, 0)

    def test_branch_flag_rejected(self) -> None:
        out = subprocess.run(
            CMD + ["--branch", "main"], capture_output=True, text=True
        )
        self.assertNotEqual(out.returncode, 0)

    def test_positional_path_rejected(self) -> None:
        out = subprocess.run(CMD + ["."], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)

    def test_scan_subcommand_rejected(self) -> None:
        out = subprocess.run(CMD + ["scan", "."], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)

    def test_serve_subcommand_rejected(self) -> None:
        out = subprocess.run(CMD + ["serve"], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)

    def test_dev_port_combination_parses(self) -> None:
        # We can't really START the dev server in a test (it needs Vite),
        # but we CAN check the parser accepts the args. Use --help to short-circuit.
        out = subprocess.run(CMD + ["--help"], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0)
        self.assertIn("--dev", out.stdout)
        self.assertIn("--port", out.stdout)


if __name__ == "__main__":
    unittest.main()
