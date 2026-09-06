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

  function freezeTree(value) {
    Object.values(value).forEach((child) => {
      if (child && typeof child === 'object') freezeTree(child);
    });
    return Object.freeze(value);
  }

  // Recorded Pilot baseline, not a live CMS lookup or permission to publish.
  const JINAN_BASELINE = freezeTree({
    pageUrl: 'https://www.tainanrehab.com/time.html',
    imagePath: '/upload/115-九月_醫師門診表 (1).png',
    imageDimensions: { width: 675, height: 1200 },
    imageBytes: 294076,
    imageSha256: '503cbde3c21bd37f0562154df3fa4029d08e65ce0c1f90b59d7af4980d17dc65',
    verifiedAt: '2026-09-06T14:48:40.842Z',
    requiresRevalidation: true,
  });

  async function createPublishJob(input, cryptoApi = globalThis.crypto) {
    // Copy before the first await: subsequent editor changes cannot alter metadata.
    const snapshot = JSON.parse(JSON.stringify(input));
    if (snapshot.channelIds?.length !== 1 || snapshot.channelIds[0] !== 'jinan-website'
        || snapshot.primaryClinicId !== 'clinic-1' || snapshot.humanConfirmed !== true
        || typeof snapshot.title !== 'string' || !snapshot.title.trim() || snapshot.title.length > 100
        || !/^\d{4}-(0[1-9]|1[0-2])$/.test(snapshot.monthKey)) {
      throw new Error('INVALID_JOB');
    }
    const encoded = snapshot.pngDataUrl;
    if (typeof encoded !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(encoded)
        || encoded.length > 21 * 1024 * 1024) throw new Error('INVALID_PNG');
    const base64 = encoded.slice('data:image/png;base64,'.length);
    const binary = atob(base64);
    if (btoa(binary) !== base64) throw new Error('INVALID_PNG');
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 45 || signature.some((byte, index) => bytes[index] !== byte)
        || binary.slice(12, 16) !== 'IHDR') throw new Error('INVALID_PNG');
    const view = new DataView(bytes.buffer);
    const dimensions = { width: view.getUint32(16), height: view.getUint32(20) };
    if (dimensions.width !== 2160 || dimensions.height !== 3840) throw new Error('INVALID_PNG');
    const jobId = cryptoApi.randomUUID();
    const createdAt = new Date().toISOString();
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return freezeTree({
      schemaVersion: 1, jobId, createdAt, status: 'READY_FOR_BROWSER_EXECUTION',
      channelId: 'jinan-website', primaryClinicId: snapshot.primaryClinicId,
      title: snapshot.title, monthKey: snapshot.monthKey, humanConfirmed: true,
      png: { dataUrl: encoded, sha256, dimensions, bytes: bytes.length },
      baseline: JSON.parse(JSON.stringify(JINAN_BASELINE)),
    });
  }

  function publishJobFilename(job) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(job.monthKey)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.jobId)) {
      throw new Error('INVALID_JOB_FILENAME');
    }
    return `jinan-publish-${job.monthKey}-${job.jobId}.json`;
  }

  function downloadPublishJob(job) {
    const filename = publishJobFilename(job);
    const url = URL.createObjectURL(new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    try {
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  return {
    PUBLISH_CHANNELS,
    evaluatePublishSelection,
    createPublishJob,
    publishJobFilename,
    downloadPublishJob,
  };
});
