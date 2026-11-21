import type { CSSProperties, ReactElement } from 'react';
import { AVATARS, getAvatarStyle } from '../../skills/avatars';
import { IsoPerson, type Look } from '../office/IsoPerson';

export type AvatarPreviewProps = {
  avatarId?: string;
  look?: Look;
  role?: string;
  mode?: '2d' | '3d';
  motion?: 'idle' | 'walking';
  size?: number;
};

export function AvatarPreview({ avatarId, look, role = 'analyst', mode, motion = 'idle', size = 120 }: AvatarPreviewProps): ReactElement {
  const m = mode ?? getAvatarStyle();
  const lookOverride = look ?? (avatarId ? AVATARS.find((a) => a.id === avatarId)?.look : undefined);
  const style = { '--avatar-size': `${size}px` } as CSSProperties;
  return (
    <div className={`avatar-preview avatar-preview--${m}`} data-mode={m} data-motion={motion} style={style}>
      <svg className="iso-office avatar-preview__svg" viewBox="-24 -90 48 112" overflow="visible" aria-hidden="true">
        <IsoPerson role={role} pose="stand" act={motion} lookOverride={lookOverride} />
      </svg>
    </div>
  );
}
