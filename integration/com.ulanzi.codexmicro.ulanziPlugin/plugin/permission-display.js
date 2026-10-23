import { fillRoundedRect, drawText, drawLine, pngDataUrl } from './encoder-raster.js';

export function permissionActionPng() {
  const pixels = new Uint8Array(196 * 196 * 4);
  fillRoundedRect(pixels, 196, 196, 2, 2, 192, 192, 30, '#bfc4c2');
  fillRoundedRect(pixels, 196, 196, 4, 4, 188, 188, 28, '#eeeeed');
  const shield = [[98, 45], [139, 62], [135, 105], [123, 127], [98, 148], [73, 127], [61, 105], [57, 62], [98, 45]];
  for (let index = 1; index < shield.length; index++) {
    for (let offset = -2; offset <= 2; offset++) drawLine(pixels, 196, 196,
      shield[index - 1][0] + offset, shield[index - 1][1], shield[index][0] + offset, shield[index][1], '#384541');
  }
  for (let offset = -2; offset <= 2; offset++) {
    drawLine(pixels, 196, 196, 78, 95 + offset, 92, 109 + offset, '#087f5b');
    drawLine(pixels, 196, 196, 92, 109 + offset, 119, 80 + offset, '#087f5b');
  }
  return pngDataUrl(pixels, 196, 196);
}

/** Draw short English labels at native dial resolution; never use the host title. */
export function permissionEncoderPng(state, choice = 'once', pending = false, connected = true) {
  const width = 126, height = 126;
  const pixels = new Uint8Array(width * height * 4);
  fillRoundedRect(pixels, width, height, 0, 0, width, height, 12, '#bfc4c2');
  fillRoundedRect(pixels, width, height, 1, 1, width - 2, height - 2, 11, '#eeeeed');
  const approval = connected && state?.mode === 'approval';
  const heading = pending ? 'SENDING' : approval ? 'APPROVAL' : state?.mode === 'confirmation' ? 'CONFIRM FULL' : 'PERMISSIONS';
  drawText(pixels, width, height, heading, 63, 9, 1, '#77837e', 110, 'middle');
  if (approval) {
    const colors = { once: '#087f5b', session: '#315d69', deny: '#ab4545' };
    state.options.forEach((option, index) => {
      const selected = option.id === choice;
      const color = !option.enabled || pending ? '#8b9490' : colors[option.id];
      const y = 25 + index * 30;
      if (selected) fillRoundedRect(pixels, width, height, 8, y - 3, 110, 26, 6, color);
      drawText(pixels, width, height, option.label, 63, y + 2, 2,
        selected ? '#ffffff' : color, 100, 'middle');
    });
  } else {
    const label = !connected ? 'OFFLINE' : state?.mode === 'confirmation' ? 'FULL' : state?.confirmationRequired ? 'CONFIRM' : state?.policy?.label ?? 'UNAVAILABLE';
    const scale = Math.min(3, 108 / (Math.max(1, label.length) * 6));
    const color = state?.policy?.label === 'FULL' || state?.confirmationRequired ? '#94621b' : '#087f5b';
    drawText(pixels, width, height, label, 63, 47, scale, color, 110, 'middle');
    const policies = state?.policies ?? [];
    const gap = 4, segment = policies.length ? (96 - (policies.length - 1) * gap) / policies.length : 96;
    policies.forEach((option, index) => fillRoundedRect(pixels, width, height,
      15 + index * (segment + gap), 91, segment, 4, 1,
      option.id === state.policy?.id ? color : '#c1c8c5'));
    if (state?.mode === 'confirmation') drawText(pixels, width, height,
      'LEFT TO CANCEL', 63, 86, 1, '#77837e', 110, 'middle');
    drawText(pixels, width, height, state?.mode === 'confirmation' ? 'PRESS TO ALLOW' : state?.confirmationRequired ? 'CHECK CODEX' : 'TURN TO CHANGE',
      63, 108, 1, '#77837e', 110, 'middle');
  }
  return pngDataUrl(pixels, width, height);
}
