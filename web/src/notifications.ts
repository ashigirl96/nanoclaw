import { useEffect } from 'react';

import type { Notice } from './api';

const TITLE_PREFIX: Record<Notice['kind'], string> = {
  reply: '',
  question: '質問: ',
  approval: '承認のお願い: ',
};

export function isForeground(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function useForeground(onChange: () => void): void {
  useEffect(() => {
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('focus', onChange);
    window.addEventListener('blur', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('focus', onChange);
      window.removeEventListener('blur', onChange);
    };
  }, [onChange]);
}

// Browsers only show the permission prompt in response to a user gesture.
export function useNotificationPermission(): void {
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    const ask = () => void Notification.requestPermission();
    window.addEventListener('pointerdown', ask, { once: true });
    return () => window.removeEventListener('pointerdown', ask);
  }, []);
}

export function announce(notice: Notice, chatName: string, onClick: () => void): void {
  if (isForeground() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const notification = new Notification(TITLE_PREFIX[notice.kind] + chatName, {
    body: notice.body,
    tag: `${notice.agentGroupId ?? 'inbox'}:${notice.kind}`,
  });
  notification.onclick = () => {
    window.focus();
    onClick();
    notification.close();
  };
}
