import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import {
  ActivityIcon,
  AttachFileIcon,
  EllipsisIcon,
  MaximizeIcon,
  MinimizeIcon,
  MonitorIcon,
  PulseIcon,
  VoiceIcon,
} from './prompt-icons';

describe('prompt icons', () => {
  it('renders every prompt icon as an svg', () => {
    const icons = [
      <AttachFileIcon key="attach" />,
      <VoiceIcon key="voice" />,
      <EllipsisIcon key="ellipsis" />,
      <PulseIcon key="pulse" />,
      <MonitorIcon key="monitor" className="monitor-icon" />,
      <MaximizeIcon key="maximize" className="maximize-icon" />,
      <MinimizeIcon key="minimize" className="minimize-icon" />,
      <ActivityIcon key="activity" className="activity-icon" />,
    ];

    const { container } = render(<div>{icons}</div>);

    expect(container.querySelectorAll('svg')).toHaveLength(icons.length);
    expect(container.querySelector('.monitor-icon')).toBeDefined();
    expect(container.querySelector('.maximize-icon')).toBeDefined();
    expect(container.querySelector('.minimize-icon')).toBeDefined();
    expect(container.querySelector('.activity-icon')).toBeDefined();
  });
});
