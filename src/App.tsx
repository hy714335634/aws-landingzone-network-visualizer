import NetworkFlow from './components/NetworkFlow';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import './App.css';

function AppInner() {
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('AWS 网络架构可视化', 'AWS Network Architecture Visualizer')}</h1>
        <p>{t('上传网络配置 JSON 文件，可视化 VPC、子网和 Transit Gateway', 'Upload network config JSON to visualize VPCs, Subnets, and Transit Gateways')}</p>
        <button
          className="lang-toggle"
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          title={t('切换到 English', 'Switch to 中文')}
        >
          {lang === 'zh' ? 'EN' : '中'}
        </button>
      </header>
      <main className="app-main">
        <NetworkFlow />
      </main>
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}

export default App;
