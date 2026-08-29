(function (root) {
    "use strict";

    var SESSION_KEY = "clinicTimetableAuthenticated";

    function bytesToHex(buffer) {
        return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
            return byte.toString(16).padStart(2, "0");
        }).join("");
    }

    async function sha256Hex(cryptoApi, value) {
        if (!cryptoApi || !cryptoApi.subtle) {
            throw new Error("Web Crypto API is required for password verification.");
        }
        var encoded = new TextEncoder().encode(value);
        var digest = await cryptoApi.subtle.digest("SHA-256", encoded);
        return bytesToHex(digest);
    }

    function createAuthGate(env, config) {
        var runtime = env || root;
        var authConfig = config || runtime.CLINIC_AUTH_CONFIG || {};
        var storage = runtime.sessionStorage;

        function isAuthenticated() {
            return storage && storage.getItem(SESSION_KEY) === "1";
        }

        async function establishServerSession(password) {
            if (typeof runtime.fetch !== "function") return true;
            var response = await runtime.fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ password: password }),
            });
            return response.ok;
        }

        async function verifyPassword(password) {
            var expectedDigest = authConfig.passwordSha256Hex;
            if (!expectedDigest || typeof password !== "string") {
                return false;
            }

            var actualDigest = await sha256Hex(runtime.crypto, password);
            var authenticated = actualDigest === expectedDigest;
            if (!authenticated) return false;

            var serverAuthenticated = await establishServerSession(password);
            if (!serverAuthenticated) return false;

            if (storage) storage.setItem(SESSION_KEY, "1");
            return true;
        }

        function logout() {
            if (storage) storage.removeItem(SESSION_KEY);
            if (typeof runtime.fetch === "function") {
                runtime.fetch("/api/auth", {
                    method: "DELETE",
                    credentials: "same-origin",
                }).catch(function () {});
            }
        }

        return {
            isAuthenticated: isAuthenticated,
            verifyPassword: verifyPassword,
            logout: logout,
        };
    }

    var exported = {
        createAuthGate: createAuthGate,
        sha256Hex: sha256Hex,
    };

    root.ClinicAuthGate = exported;
    root.AuthGate = createAuthGate(root, root.CLINIC_AUTH_CONFIG);

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
