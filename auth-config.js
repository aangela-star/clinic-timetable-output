(function (root) {
    "use strict";

    var config = {
        // FRONTEND_ONLY_SHARED_SECRET: local test digest only. Replace before deployment.
        passwordSha256Hex: "b47375fb75aa2e5de5a65f854f3f125c2e9680867d248286d45dd5d3751cde1c",
    };

    root.CLINIC_AUTH_CONFIG = config;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { CLINIC_AUTH_CONFIG: config };
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
