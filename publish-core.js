(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root && root.window) {
    root.window.PublishCore = api;
  } else if (root) {
    root.PublishCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PUBLISH_CHANNELS = [
    {
      id: 'jinan-website',
      label: '晉安官網',
      requiredPrimaryClinicId: 'clinic-1',
    },
  ];

  function evaluatePublishSelection(channels, selectedChannelIds, primaryClinicId) {
    const selectedChannels = channels.filter((channel) =>
      selectedChannelIds.includes(channel.id)
    );

    if (selectedChannels.length === 0) {
      return {
        canConfirm: false,
        warning: '',
      };
    }

    const incompatibleChannel = selectedChannels.find(
      (channel) =>
        channel.requiredPrimaryClinicId &&
        channel.requiredPrimaryClinicId !== primaryClinicId
    );

    return {
      canConfirm: !incompatibleChannel,
      warning: incompatibleChannel
        ? `${incompatibleChannel.label}建議使用晉安優先版本`
        : '',
    };
  }

  return {
    PUBLISH_CHANNELS,
    evaluatePublishSelection,
  };
});
