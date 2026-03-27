import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Copy, FileText, Check, Terminal, AlertTriangle, Info } from 'lucide-react';
import type { OverlayResource, VpnConfig, CgwConfig, VgwConfig } from '../types/overlay';
import type { OperationGuide as GuideType, GuideStep } from '../data/guideTemplates';
import { generateVpnGuide, generateCgwGuide, generateVgwGuide } from '../data/guideTemplates';
import type { TgwConfig } from '../types/network';
import { useLanguage } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/LanguageContext';

interface OperationGuideProps {
  resource: OverlayResource;
  tgwConfig?: TgwConfig;
}

function generateGuide(resource: OverlayResource, tgwConfig?: TgwConfig, lang?: Lang): GuideType | null {
  switch (resource.type) {
    case 'vpn': {
      const cfg = resource.config as VpnConfig;
      return generateVpnGuide({
        vpnName: cfg.name,
        tgwAsn: tgwConfig?.asn,
        cgwIp: cfg.customerGatewayIp,
        cgwAsn: cfg.remoteAsn,
        routingType: cfg.routingType,
        tunnels: cfg.tunnels,
        insideCidrs: cfg.insideCidrs,
        staticRoutes: cfg.staticRoutes,
      }, lang);
    }
    case 'cgw': {
      const cfg = resource.config as CgwConfig;
      return generateCgwGuide({ name: cfg.name, bgpAsn: cfg.bgpAsn, ipAddress: cfg.ipAddress }, lang);
    }
    case 'vgw': {
      const cfg = resource.config as VgwConfig;
      return generateVgwGuide({ name: cfg.name, asn: cfg.asn, vpcName: cfg.vpcId }, lang);
    }
    default:
      return null;
  }
}

function StepCard({ step, isOpen, onToggle }: { step: GuideStep; isOpen: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className={`guide-step ${isOpen ? 'open' : ''}`}>
      <div className="guide-step-header" onClick={onToggle}>
        <span className="guide-step-number">{step.order}</span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="guide-step-title">{step.title}</span>
      </div>

      {isOpen && (
        <div className="guide-step-body">
          <div className="guide-console-path">
            <FileText size={12} />
            <span>{step.consolePath}</span>
          </div>

          <div className="guide-fields">
            {step.fields.map((field, i) => (
              <div key={i} className="guide-field">
                <div className="guide-field-head">
                  <span className="guide-field-name">
                    {field.name}
                    {field.required && <span className="guide-required">*</span>}
                  </span>
                  <button className="guide-copy-btn"
                    onClick={() => handleCopy(field.value, `${step.order}-${i}`)}
                    title="复制值">
                    {copied === `${step.order}-${i}` ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </div>
                <div className="guide-field-value">{field.value}</div>
                {field.description && <div className="guide-field-desc">{field.description}</div>}
              </div>
            ))}
          </div>

          {step.notes && step.notes.length > 0 && (
            <div className="guide-notes">
              {step.notes.map((note, i) => (
                <div key={i} className="guide-note">
                  <Info size={10} />
                  <span>{note}</span>
                </div>
              ))}
            </div>
          )}

          {step.awsCliEquivalent && (
            <div className="guide-cli">
              <div className="guide-cli-header">
                <Terminal size={11} />
                <span>AWS CLI</span>
                <button className="guide-copy-btn"
                  onClick={() => handleCopy(step.awsCliEquivalent!, `cli-${step.order}`)}>
                  {copied === `cli-${step.order}` ? <Check size={10} /> : <Copy size={10} />}
                </button>
              </div>
              <pre className="guide-cli-code">{step.awsCliEquivalent}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OperationGuide({ resource, tgwConfig }: OperationGuideProps) {
  const { lang, t } = useLanguage();
  const guide = useMemo(() => generateGuide(resource, tgwConfig, lang), [resource, tgwConfig, lang]);
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([1]));
  const [allCopied, setAllCopied] = useState(false);

  if (!guide) {
    return (
      <div className="guide-panel">
        <div className="guide-empty">
          <AlertTriangle size={16} />
          <span>{t('暂无该资源类型的操作指南', 'No operation guide for this resource type')}</span>
        </div>
      </div>
    );
  }

  const toggleStep = (order: number) => {
    setOpenSteps(prev => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order); else next.add(order);
      return next;
    });
  };

  const handleCopyAll = () => {
    const text = formatGuideAsText(guide, lang);
    navigator.clipboard.writeText(text);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  return (
    <div className="guide-panel">
      <div className="guide-header">
        <div className="guide-title">{guide.title}</div>
        <button className="guide-copy-all-btn" onClick={handleCopyAll}>
          {allCopied ? <><Check size={12} /> {t('已复制', 'Copied')}</> : <><Copy size={12} /> {t('复制全部步骤', 'Copy All Steps')}</>}
        </button>
      </div>

      {/* Context values */}
      <div className="guide-context">
        {Object.entries(guide.contextValues).map(([k, v]) => (
          <div key={k} className="guide-ctx-item">
            <span className="guide-ctx-key">{k}</span>
            <span className="guide-ctx-val">{v}</span>
          </div>
        ))}
      </div>

      {/* Prerequisites */}
      <div className="guide-prereq">
        <div className="guide-prereq-title">{t('前置条件', 'Prerequisites')}</div>
        {guide.prerequisites.map((p, i) => (
          <div key={i} className="guide-prereq-item">
            <span className="guide-prereq-check">✓</span>
            <span>{p}</span>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="guide-steps">
        {guide.steps.map(step => (
          <StepCard key={step.order} step={step}
            isOpen={openSteps.has(step.order)}
            onToggle={() => toggleStep(step.order)} />
        ))}
      </div>
    </div>
  );
}

// ============================================
// Export as plain text
// ============================================

function formatGuideAsText(guide: GuideType, lang: Lang): string {
  const T = (zh: string, en: string) => lang === 'en' ? en : zh;
  const lines: string[] = [];
  lines.push(`# ${guide.title}`);
  lines.push('');
  lines.push(`## ${T('配置参数', 'Parameters')}`);
  Object.entries(guide.contextValues).forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
  lines.push('');
  lines.push(`## ${T('前置条件', 'Prerequisites')}`);
  guide.prerequisites.forEach(p => lines.push(`- ${p}`));
  lines.push('');

  guide.steps.forEach(step => {
    lines.push(`## Step ${step.order}: ${step.title}`);
    lines.push(`${T('控制台路径', 'Console path')}: ${step.consolePath}`);
    lines.push('');
    step.fields.forEach(f => {
      lines.push(`- ${f.name}: ${f.value}${f.required ? ' *' : ''}`);
      if (f.description) lines.push(`  ${T('说明', 'Note')}: ${f.description}`);
    });
    if (step.notes?.length) {
      lines.push('');
      lines.push(`${T('注意', 'Notes')}:`);
      step.notes.forEach(n => lines.push(`  - ${n}`));
    }
    if (step.awsCliEquivalent) {
      lines.push('');
      lines.push(`AWS CLI: ${step.awsCliEquivalent}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
