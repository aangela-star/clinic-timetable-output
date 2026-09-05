(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root && root.window) {
    root.window.ClinicOrder = api;
  } else if (root) {
    root.ClinicOrder = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function orderClinicsByPriority(clinics, priorityClinicId) {
    const ordered = clinics.slice();
    const priorityIndex = ordered.findIndex((clinic) => clinic.id === priorityClinicId);

    if (priorityIndex <= 0) {
      return ordered;
    }

    const priorityClinic = ordered[priorityIndex];
    ordered.splice(priorityIndex, 1);
    ordered.unshift(priorityClinic);

    return ordered;
  }

  return {
    orderClinicsByPriority,
  };
});
