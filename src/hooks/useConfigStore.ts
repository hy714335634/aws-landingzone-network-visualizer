import { useState, useCallback, useRef } from 'react';
import type { NetworkConfig } from '../types/network';

export interface ConfigStore {
  /** 当前配置对象（单一数据源） */
  config: NetworkConfig | null;
  /** 当前 JSON 文本（与 config 同步） */
  jsonText: string;
  /** 源文件引用（用于刷新） */
  sourceFile: File | null;
  /** 当前选中的 JSON 路径 */
  selectedPath: string | null;

  /** 从文件加载配置 */
  loadFromFile: (file: File) => boolean;
  /** 从 JSON 对象加载 */
  loadFromObject: (obj: unknown) => void;
  /** 从编辑器文本更新配置 */
  updateFromText: (text: string) => string | null;
  /** 从属性面板更新配置（局部修改） */
  updateConfig: (newConfig: NetworkConfig) => void;
  /** 设置选中路径 */
  setSelectedPath: (path: string | null) => void;
  /** 下载完整 JSON */
  downloadJson: () => void;
  /** 刷新（重新加载源文件） */
  refresh: () => boolean;
}

export function useConfigStore(): ConfigStore {
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // 保留原始完整 JSON 对象的引用，确保未可视化字段不丢失
  const fullConfigRef = useRef<unknown>(null);

  const syncTextFromConfig = useCallback((cfg: unknown) => {
    const text = JSON.stringify(cfg, null, 2);
    setJsonText(text);
    return text;
  }, []);

  const loadFromObject = useCallback((obj: unknown) => {
    fullConfigRef.current = obj;
    const networkConfig = obj as NetworkConfig;
    setConfig(networkConfig);
    syncTextFromConfig(obj);
  }, [syncTextFromConfig]);

  const loadFromFile = useCallback((file: File): boolean => {
    setSourceFile(file);
    return true; // actual reading is async, handled by caller
  }, []);

  const updateFromText = useCallback((text: string): string | null => {
    try {
      const parsed = JSON.parse(text);
      fullConfigRef.current = parsed;
      setConfig(parsed as NetworkConfig);
      setJsonText(text);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  const updateConfig = useCallback((newConfig: NetworkConfig) => {
    // 合并到完整配置中，保留未可视化的字段
    fullConfigRef.current = newConfig;
    setConfig(newConfig);
    syncTextFromConfig(newConfig);
  }, [syncTextFromConfig]);

  const downloadJson = useCallback(() => {
    const data = fullConfigRef.current || config;
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'network-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const refresh = useCallback((): boolean => {
    if (sourceFile) return true; // caller handles async file read
    if (config) {
      syncTextFromConfig(fullConfigRef.current || config);
      return true;
    }
    return false;
  }, [sourceFile, config, syncTextFromConfig]);

  return {
    config,
    jsonText,
    sourceFile,
    selectedPath,
    loadFromFile,
    loadFromObject,
    updateFromText,
    updateConfig,
    setSelectedPath,
    downloadJson,
    refresh,
  };
}
