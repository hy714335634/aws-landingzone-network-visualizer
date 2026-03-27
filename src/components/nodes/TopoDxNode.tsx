import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Cable } from 'lucide-react';

interface TopoDxNodeData {
  asn?: number;
  prefixes?: string[];
}

const TopoDxNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoDxNodeData;
  return (
    <div className="topo-dx">
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Top} id="source-top" />
      <div className="topo-dx-row">
        <Cable size={14} />
        <span>Direct Connect</span>
      </div>
      {d.asn != null && <div className="topo-dx-detail">ASN {d.asn}</div>}
      {d.prefixes?.length ? (
        <div className="topo-dx-detail">{d.prefixes.join(', ')}</div>
      ) : null}
    </div>
  );
});

TopoDxNode.displayName = 'TopoDxNode';
export default TopoDxNode;
