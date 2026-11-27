import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { AudioEngine } from '../audio/engine';

const AudioEngineContext = createContext<AudioEngine | null>(null);

/** 全域單例 AudioEngine 提供者 */
export function AudioProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AudioEngine();
  }

  useEffect(() => {
    const engine = engineRef.current;
    return () => {
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <AudioEngineContext.Provider value={engineRef.current}>
      {children}
    </AudioEngineContext.Provider>
  );
}

/** 取得全域 AudioEngine 實例 */
export function useAudioEngine(): AudioEngine {
  const engine = useContext(AudioEngineContext);
  if (!engine) {
    throw new Error('useAudioEngine 必須在 AudioProvider 內使用');
  }
  return engine;
}
