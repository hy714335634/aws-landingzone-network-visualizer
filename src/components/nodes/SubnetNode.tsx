import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

interface SubnetNodeData {
  cidr: string;
  ipCount: number;
  typeName: string;
  typeLabel: string;
}

// 格式化 IP 数量
function formatIpCount(count: number): string {
  if (count >= 1024) {
    return `${(count / 1024).toFixed(count % 1024 === 0 ? 0 : 1)}K`;
  }
  return count.toString();
}

const SubnetNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as SubnetNodeData;
  return (
    <div className="subnet-item">
      <span className="subnet-type-label">{nodeData.typeLabel}</span>
      <span className="subnet-cidr">{nodeData.cidr}</span>
      <span className="subnet-ip-count">({formatIpCount(nodeData.ipCount)} IPs)</span>
    </div>
  );
});

SubnetNode.displayName = 'SubnetNode';
export default SubnetNode;
