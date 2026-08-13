import { useEffect, useState } from 'react';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import app from '../lib/firebase';

let rcInstance: ReturnType<typeof getRemoteConfig> | null = null;
function getRC() {
  if (typeof window === 'undefined') return null;
  if (!rcInstance) {
    rcInstance = getRemoteConfig(app);
    rcInstance.settings.minimumFetchIntervalMillis = 3600000; // 1 hour
  }
  return rcInstance;
}

export function useRemoteConfigBool(key: string, defaultValue: boolean): boolean {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const rc = getRC();
    if (!rc) return;
    // Set in-app default so getValue returns the right thing before network resolves.
    rc.defaultConfig = { ...rc.defaultConfig, [key]: defaultValue };
    fetchAndActivate(rc)
      .then(() => {
        const fetched = getValue(rc, key).asBoolean();
        setValue(fetched);
      })
      .catch(() => {
        // Network unavailable — stay on defaultValue already set via useState.
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return value;
}
