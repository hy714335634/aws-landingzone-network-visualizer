import { useState, useCallback } from 'react';
import type { OverlayResource, RouteSimulation } from '../types/overlay';

export interface OverlayStore {
  resources: OverlayResource[];
  routes: RouteSimulation[];
  selectedOverlayId: string | null;

  addResource: (resource: OverlayResource) => void;
  updateResource: (id: string, updates: Partial<OverlayResource>) => void;
  removeResource: (id: string) => void;
  selectOverlay: (id: string | null) => void;
  setRoutes: (routes: RouteSimulation[]) => void;
  clearAll: () => void;
}

let nextId = 1;
export function generateOverlayId(type: string): string {
  return `overlay-${type}-${nextId++}`;
}

export function useOverlayStore(): OverlayStore {
  const [resources, setResources] = useState<OverlayResource[]>([]);
  const [routes, setRoutes] = useState<RouteSimulation[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  const addResource = useCallback((resource: OverlayResource) => {
    setResources(prev => [...prev, resource]);
  }, []);

  const updateResource = useCallback((id: string, updates: Partial<OverlayResource>) => {
    setResources(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  const removeResource = useCallback((id: string) => {
    setResources(prev => prev.filter(r => r.id !== id));
    setRoutes(prev => prev.filter(r => r.from !== id && r.to !== id));
    setSelectedOverlayId(prev => prev === id ? null : prev);
  }, []);

  const selectOverlay = useCallback((id: string | null) => {
    setSelectedOverlayId(id);
  }, []);

  const clearAll = useCallback(() => {
    setResources([]);
    setRoutes([]);
    setSelectedOverlayId(null);
  }, []);

  return {
    resources, routes, selectedOverlayId,
    addResource, updateResource, removeResource, selectOverlay, setRoutes, clearAll,
  };
}
