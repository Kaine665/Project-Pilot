/**
 * Notification system constants.
 */

export const NOTIFICATION_CONFIG = {
  // Prefix for native notification tags, used to group the same session.
  TAG_PREFIX: 'agent-complete',
  DEFAULT_ICON: '/favicon.ico',
  MAX_PREVIEW_LENGTH: 96,
};

export const AUDIO_CONFIG = {
  DEFAULT_SOUND_PATH: '/sounds/agent-complete.mp3',
  DEFAULT_VOLUME: 0.5,
  MAX_RETRIES: 2,
  RETRY_DELAY: 50,
};
