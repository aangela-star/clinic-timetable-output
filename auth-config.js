(function (root) {
    "use strict";

    var config = {
        // FRONTEND_ONLY_SHARED_SECRET: production digest is frontend-visible.
        passwordSha256Hex: "c6cd74a999b732d791159f2e08ddf7fb52f004b60d409d14367facf0d546a615",
    };

    root.CLINIC_AUTH_CONFIG = config;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { CLINIC_AUTH_CONFIG: config };
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
