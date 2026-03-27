import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Globe2 } from 'lucide-react';

interface TopoRegionLabelData {
  label: string;
  isMain?: boolean;
}

const TopoRegionLabelNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoRegionLabelData;
  // Background-only node (empty label) — render nothing, styled via node.style
  if (!d.label) {
    return <div className="topo-region-bg" />;
  }
  return (
    <div className={`topo-region-label ${d.isMain ? 'is-main' : 'is-peer'}`}>
      <Globe2 size={13} />
      <span>{d.label}</span>
    </div>
  );
});

TopoRegionLabelNode.displayName = 'TopoRegionLabelNode';
export default TopoRegionLabelNode;
