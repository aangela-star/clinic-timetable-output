import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


EXPECTED_DEPENDENCIES = [
    "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
    "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
    "auth-config.js",
    "auth-gate.js",
    "schedule-api-config.js",
    "schedule-save-load-core.js",
    "clinic-order.js",
    "https://unpkg.com/@babel/standalone@8.0.4/babel.min.js",
    "https://cdn.tailwindcss.com/3.4.17",
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
    "https://unpkg.com/lucide@1.33.0/dist/umd/lucide.min.js",
]

EXPECTED_EXTERNAL_DEPENDENCIES = [
    "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
    "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
    "https://unpkg.com/@babel/standalone@8.0.4/babel.min.js",
    "https://cdn.tailwindcss.com/3.4.17",
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
    "https://unpkg.com/lucide@1.33.0/dist/umd/lucide.min.js",
]


class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.has_html = False
        self.has_root = False
        self.script_srcs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.has_html = True
        if tag == "div" and attrs.get("id") == "root":
            self.has_root = True
        if tag == "script" and "src" in attrs:
            self.script_srcs.append(attrs["src"])


class DeploymentSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = Path("index.html").read_text(encoding="utf-8")
        cls.parser = IndexParser()
        cls.parser.feed(cls.html)

    def test_html_entrypoint_and_root_exist(self):
        self.assertTrue(self.parser.has_html)
        self.assertTrue(self.parser.has_root)

    def test_runtime_dependencies_are_pinned_and_ordered(self):
        self.assertEqual(self.parser.script_srcs, EXPECTED_DEPENDENCIES)

    def test_external_runtime_dependencies_remain_exactly_pinned(self):
        external_srcs = [
            src for src in self.parser.script_srcs if src.startswith("https://")
        ]
        self.assertEqual(external_srcs, EXPECTED_EXTERNAL_DEPENDENCIES)

    def test_auth_scripts_load_before_babel_app(self):
        self.assertLess(
            self.parser.script_srcs.index("auth-config.js"),
            self.parser.script_srcs.index("https://unpkg.com/@babel/standalone@8.0.4/babel.min.js"),
        )
        self.assertLess(
            self.parser.script_srcs.index("auth-gate.js"),
            self.parser.script_srcs.index("https://unpkg.com/@babel/standalone@8.0.4/babel.min.js"),
        )

    def test_login_form_uses_password_input(self):
        self.assertRegex(self.html, r'<input[^>]+type="password"')
        self.assertNotIn("LOCAL_TEST_ONLY_PASSWORD", self.html)

    def test_main_ui_is_not_rendered_before_authentication(self):
        self.assertNotIn("root.render(<App />)", self.html)
        self.assertRegex(self.html, r"AuthGate\.isAuthenticated\(\)")
        self.assertRegex(self.html, r"authenticated\s*\?\s*<App\s+onLogout=\{handleLogout\}\s*/>")

    def test_logout_control_is_wired(self):
        self.assertIn("登出", self.html)
        self.assertRegex(self.html, r"AuthGate\.logout\(\)")
        self.assertRegex(self.html, r"onClick=\{onLogout\}")

    def test_no_floating_runtime_aliases_remain(self):
        dependency_text = "\n".join(EXPECTED_EXTERNAL_DEPENDENCIES)
        self.assertNotIn("@latest", dependency_text)
        self.assertNotRegex(dependency_text, r"react@18/")
        self.assertNotRegex(dependency_text, r"react-dom@18/")
        self.assertNotIn("https://unpkg.com/@babel/standalone/babel.min.js", dependency_text)
        self.assertNotIn("https://cdn.tailwindcss.com\n", dependency_text + "\n")


if __name__ == "__main__":
    unittest.main()
