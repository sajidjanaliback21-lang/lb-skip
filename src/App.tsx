import { useState, useEffect } from "react";
import { 
  Copy, 
  Check, 
  Link as LinkIcon, 
  ShieldCheck, 
  FileText, 
  Settings, 
  Server, 
  RefreshCw, 
  ArrowRight, 
  Download, 
  ExternalLink, 
  Layers, 
  Database,
  Search,
  CheckCircle2,
  AlertTriangle,
  Code
} from "lucide-react";

import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "./lb-mapping.js";

interface StatsData {
  totalRequests: number;
  totalBytesProcessed: number;
  activeMappingsCount: number;
  ipHits: { [ip: string]: number };
  recentRewrites: Array<{
    id: string;
    timestamp: string;
    sourceUrl: string;
    customDomain: string;
    elapsedMs: number;
    replacements: number;
    originalSize: number;
    rewrittenSize: number;
  }>;
  activeMappings: { [ip: string]: string };
  defaultServer: string;
  isVercel?: boolean;
}

export default function App() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  
  // Interactive test states
  const [rawText, setRawText] = useState(`#EXTM3U\n#EXTINF:-1,Sample Live Stream Channel 1\nhttp://103.169.98.238:8080/live/user/pwd/123.ts\n#EXTINF:-1,Sample Live Stream Channel 2 (Alternative LB)\nhttp://45.148.147.213/live/user/pwd/104.ts\n#EXTINF:-1,Movie Server Direct Node\nhttp://181.215.178.23:8000/movie/user/pwd/99.mp4`);
  const [customDomainInput, setCustomDomainInput] = useState("hdsj.store");
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewrittenResult, setRewrittenResult] = useState<any | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);

  // Link generator states
  const [inputUrl, setInputUrl] = useState(`http://45.142.0.21/get.php?username=demouser&password=easyiptv12&output=ts`);
  const [generatorDomain, setGeneratorDomain] = useState("hdsj.store");
  const [generatedLink, setGeneratedLink] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // Manual IP Map creator state
  const [currentMappings, setCurrentMappings] = useState<{ [ip: string]: string }>(INITIAL_MAPPINGS);

  // Calculate live generated link when input conditions change
  useEffect(() => {
    const origin = window.location.origin;
    let finalDomainStr = "";
    if (generatorDomain.trim()) {
      finalDomainStr = `&customDomain=${encodeURIComponent(generatorDomain.trim())}`;
    }
    const link = `${origin}/playlist?url=${encodeURIComponent(inputUrl.trim())}${finalDomainStr}`;
    setGeneratedLink(link);
  }, [inputUrl, generatorDomain]);

  // Fetch real-time metrics
  const fetchStats = async () => {
    setIsLoadingStats(true);
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        if (data.activeMappings) {
          setCurrentMappings(data.activeMappings);
        }
      }
    } catch (e) {
      console.error("Could not fetch server statistics", e);
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Post raw m3u rewrite
  const handleRewriteRaw = async () => {
    if (!rawText.trim()) return;
    setIsRewriting(true);
    setRewrittenResult(null);
    try {
      const res = await fetch("/api/rewrite-raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: rawText,
          customDomain: customDomainInput.trim() || undefined,
          Mappings: currentMappings
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRewrittenResult(data);
      } else {
        const err = await res.json();
        alert(`Rewriter Error: ${err.error || "Failed to parse text input"}`);
      }
    } catch (e: any) {
      alert(`Network Error: ${e.message || "Something went wrong"}`);
    } finally {
      setIsRewriting(false);
    }
  };

  // Helper function to calculate readable size
  const formatBytes = (bytes: number) => {
    if (!bytes) return "0 Bytes";
    if (bytes < 1024) return bytes + " Bytes";
    if (bytes < 1048576) return (bytes / 1024).toFixed(2) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  };

  // Download Rewritten content to user PC
  const downloadPlaylistFile = () => {
    if (!rewrittenResult?.rewrittenContent) return;
    const element = document.createElement("a");
    const file = new Blob([rewrittenResult.rewrittenContent], { type: "text/plain;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = "rewritten_playlist.m3u";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const copyToClipboard = (text: string, setCopiedFn: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopiedFn(true);
    setTimeout(() => setCopiedFn(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950" id="rewriter-app-root">
      
      {/* Top Professional Decorative Status Ribbon */}
      <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-indigo-800 px-4 py-2.5 text-center text-xs font-medium tracking-wider text-indigo-50 flex items-center justify-center gap-2 border-b border-indigo-500/30">
        <ShieldCheck className="h-4 w-4 text-cyan-300 animate-pulse" />
        <span>Vercel-Optimized IPTV Rewriter Middleware: Zero Video Stream Bandwidth Proxied</span>
        <span className="hidden md:inline px-1.5 py-0.5 rounded bg-indigo-900/50 text-[10px] uppercase font-bold text-cyan-200">Anti-Suspension Guard Active</span>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto w-full px-4 py-8 md:py-12 flex-grow">
        
        {/* Hero Section */}
        <header className="mb-10 text-center md:text-left md:flex md:items-center md:justify-between border-b border-slate-800 pb-8">
          <div>
            <div className="inline-flex items-center gap-2 bg-indigo-500/10 text-indigo-400 text-xs px-3 py-1.5 rounded-full font-semibold mb-3 border border-indigo-500/20">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
              Mainstream Server: {DEFAULT_MAIN_SERVER_IP}
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-slate-300 to-cyan-400 bg-clip-text text-transparent" id="app-title">
              IPTV Playlist URL Rewriter
            </h1>
            <p className="text-slate-400 mt-2 text-sm md:text-base max-w-3xl">
              Strictly intercepts, processes, and rewrites M3U8 string templates inside player playlists dynamically. Resolves backend cluster IPs to custom domain targets without incurring video stream bandwidth limits on Vercel.
            </p>
          </div>

          <div className="mt-6 md:mt-0 flex gap-3 justify-center">
            <button 
              onClick={fetchStats}
              title="Refresh Stats"
              className="inline-flex items-center gap-2 bg-slate-900 border border-slate-700 hover:border-indigo-500 hover:bg-slate-800 transition px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingStats ? 'animate-spin' : ''}`} />
              Sync Metrics
            </button>
            <a 
              href="#github-setup" 
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 transition px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow-lg shadow-indigo-600/20"
            >
              Vercel Deploy Guide
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Columns - Actions & Generator (Span 2) */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* 1. M3U Web Link Generator Utility */}
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl" id="link-generator">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <LinkIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Live M3U URL Smart Generator</h2>
                  <p className="text-xs text-slate-400">Generate a custom rewritten routing URL that your IPTV Player can query directly.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex justify-between">
                    <span>Original Provider IPTV Playlist Link (with User Credentials)</span>
                    <span className="text-indigo-400">Main Server: {DEFAULT_MAIN_SERVER_IP}</span>
                  </label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={inputUrl} 
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="e.g., http://45.142.0.21/get.php?username=XXX&password=XXX&output=ts"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 pl-3 pr-10 text-sm focus:outline-none focus:border-indigo-500 text-slate-200 transition"
                      id="input-original-url"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-500">
                      <Layers className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    This link can point to your Main URL. The rewriter will load compilation streams from this URL safely.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Rewrite To Domain Target
                    </label>
                    <input 
                      type="text" 
                      value={generatorDomain} 
                      onChange={(e) => setGeneratorDomain(e.target.value)}
                      placeholder="hdsj.store (Leave blank for default mapping)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:border-indigo-500 text-slate-200 transition"
                      id="input-target-domain"
                    />
                  </div>
                  <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse"></div>
                    <div className="text-xs">
                      <span className="font-bold text-slate-300">Default Mapping Rule:</span>
                      <p className="text-slate-500">Changes load balancer nodes into <code className="text-indigo-300 text-[10px] font-mono">lb*.hdsj.store</code></p>
                    </div>
                  </div>
                </div>

                {/* Generated Result Container */}
                <div className="mt-6 pt-6 border-t border-slate-800">
                  <div className="bg-slate-950 p-4 rounded-lg border border-indigo-500/25">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-cyan-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        YOUR DIRECT IPTV REWRITE ENDPOINT
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">Use this on player apps</span>
                    </div>
                    <p className="text-[11px] text-emerald-300 font-mono break-all line-clamp-2 select-all">
                      {generatedLink}
                    </p>
                    
                    <div className="mt-3 flex flex-wrap gap-2 justify-end">
                      <button
                        onClick={() => copyToClipboard(generatedLink, setCopiedLink)}
                        className="inline-flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3.5 py-1.5 rounded-md transition cursor-pointer"
                        id="copy-generated-url"
                      >
                        {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedLink ? "Copied Link!" : "Copy URL to Clipboard"}
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </section>

            {/* 2. Paste & Test Rewriter M3U Playground */}
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl" id="interactive-playground">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Code className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Direct String Re-mapping Playground</h2>
                  <p className="text-xs text-slate-400">Paste raw M3U playlist file content to run the regex substitution algorithm instantly.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Original Playlist Editor</span>
                    <button 
                      onClick={() => setRawText(`#EXTM3U\n#EXTINF:-1,Ultra HD Feed\nhttp://103.169.98.238/play/999.ts\n#EXTINF:-1,Full HD Backup\nhttp://45.148.147.213:3000/stream.m3u8`)}
                      className="text-[10px] text-indigo-400 hover:underline hover:text-indigo-300 cursor-pointer"
                    >
                      Reset with sample template
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Place #EXTM3U entries containing target IPs here..."
                    className="w-full bg-slate-150 bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono focus:outline-none focus:border-indigo-500 text-slate-200 transition resize-y"
                    id="raw-playlist-text-area"
                  />
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="flex-grow">
                    <div className="text-xs font-medium text-slate-400">Scope Target Domain:</div>
                    <input 
                      type="text" 
                      value={customDomainInput}
                      onChange={(e) => setCustomDomainInput(e.target.value)}
                      placeholder="hdsj.store"
                      className="bg-transparent text-sm font-semibold text-indigo-300 focus:outline-none w-full"
                    />
                  </div>
                  <button
                    onClick={handleRewriteRaw}
                    disabled={isRewriting || !rawText.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold uppercase tracking-wider py-2 px-5 rounded-lg transition"
                    id="submit-raw-rewrite-playground"
                  >
                    {isRewriting ? "Parsing..." : "Convert Content"}
                  </button>
                </div>

                {/* Rewriter Result Output Panel */}
                {rewrittenResult && (
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3 animate-fadeIn">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div>
                        <span className="text-xs font-bold text-emerald-400">Conversion Successful</span>
                        <p className="text-[10px] text-slate-500">Processed in {rewrittenResult.elapsedMs}ms • Found {rewrittenResult.replacements} target matches</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => copyToClipboard(rewrittenResult.rewrittenContent, setCopiedRaw)}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-2.5 py-1 rounded text-xs transition inline-flex items-center gap-1.5"
                        >
                          {copiedRaw ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                          {copiedRaw ? "Copied" : "Copy Results"}
                        </button>
                        <button
                          onClick={downloadPlaylistFile}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-2.5 py-1 rounded text-xs transition inline-flex items-center gap-1.5"
                        >
                          <Download className="h-3 w-3" />
                          Save File
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-center">
                      <div className="bg-slate-900 px-3 py-2 rounded border border-slate-800/60">
                        <div className="text-[10px] text-slate-500">Original Size</div>
                        <div className="text-xs font-mono font-bold text-slate-300">{formatBytes(rewrittenResult.originalSize)}</div>
                      </div>
                      <div className="bg-slate-900 px-3 py-2 rounded border border-slate-800/60">
                        <div className="text-[10px] text-slate-500">Rewritten Size</div>
                        <div className="text-xs font-mono font-bold text-slate-300">{formatBytes(rewrittenResult.rewrittenSize)}</div>
                      </div>
                      <div className="bg-slate-900 px-3 py-2 rounded border border-slate-800/60">
                        <div className="text-[10px] text-slate-500">Replacements</div>
                        <div className="text-xs font-mono font-bold text-cyan-400">{rewrittenResult.replacements} items</div>
                      </div>
                      <div className="bg-slate-900 px-3 py-2 rounded border border-slate-800/60 font-mono">
                        <div className="text-[10px] text-slate-500">Compression</div>
                        <div className="text-xs font-bold text-slate-300">100% (No Loss)</div>
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Preview of Modified Output Code:</span>
                      <pre className="text-[11px] font-mono bg-slate-900 p-3 rounded text-indigo-200 overflow-x-auto max-h-48 whitespace-pre border border-slate-800/50">
                        {rewrittenResult.rewrittenContent}
                      </pre>
                    </div>

                    {Object.keys(rewrittenResult.detectedIpsHits).length > 0 && (
                      <div className="pt-2">
                        <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Occurrences By Target Load Balancer:</span>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {Object.entries(rewrittenResult.detectedIpsHits).map(([ip, count]) => (
                            <span key={ip} className="bg-cyan-950/40 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/15">
                              {ip} ({count as number} matches rewritten)
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

          </div>

          {/* Right Column - Status, Map Configuration and Guide */}
          <div className="space-y-8 col-span-1">
            
            {/* 3. Static Mapping Visualizer */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl" id="mappings-viewer">
              <div className="flex items-center gap-2 mb-4">
                <Database className="h-5 w-5 text-indigo-400" />
                <h3 className="text-slate-100 font-bold text-md">lb-mapping.js Active Nodes</h3>
              </div>

              <p className="text-slate-400 text-xs mb-4">
                This applet processes matches dynamically using this lookup table. You can customize this by editing the standard mapping list in your server code repository.
              </p>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {Object.entries(currentMappings).map(([ip, domain]) => {
                  const hits = stats?.ipHits?.[ip] || 0;
                  const domainStr = domain as string;
                  return (
                    <div key={ip} className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between text-xs hover:border-indigo-500/20 transition">
                      <div>
                        <span className="font-mono text-[11px] text-emerald-400 block">{ip}</span>
                        <span className="font-mono text-[10px] text-indigo-300">{domainStr.replace("hdsj.store", generatorDomain || "hdsj.store")}</span>
                      </div>
                      <div className="text-right">
                        <span className="bg-indigo-950 text-indigo-300 text-[10px] px-2 py-0.5 rounded border border-indigo-500/20">
                          {hits} replacements
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-amber-950/20 p-3 rounded-lg border border-amber-500/10 mt-4 text-xs text-amber-300 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                <p className="leading-relaxed text-[11px]">
                  <strong>Bandwidth Warning Limit Mitigation:</strong> If players connect to these rewritten subdomains, video streaming packets go direct to provider node servers, preserving your Vercel bandwidth quota and ensuring stable execution.
                </p>
              </div>
            </div>

            {/* 4. Real-time Monitoring Info */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl" id="realtime-metrics">
              <div className="flex items-center gap-2 mb-4">
                <Server className="h-5 w-5 text-indigo-400 animate-pulse" />
                <h3 className="text-slate-100 font-bold text-md">Proxy Performance Analytics</h3>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-950 p-3 rounded border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">Total Proxy Requests</span>
                  <span className="text-lg font-bold text-indigo-300">{stats?.totalRequests ?? 0}</span>
                </div>
                <div className="bg-slate-950 p-3 rounded border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">Text Bytes Cached</span>
                  <span className="text-xs font-bold text-indigo-300 break-all">{formatBytes(stats?.totalBytesProcessed ?? 0)}</span>
                </div>
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-300 block mb-2">Platform Engine Status:</span>
                <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-1.5 text-xs text-slate-400 font-mono">
                  <div className="flex justify-between">
                    <span>Active Clusters:</span>
                    <span className="text-emerald-400 font-bold">{stats?.activeMappingsCount ?? 6} nodes</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Host Server IP:</span>
                    <span className="text-slate-300">{DEFAULT_MAIN_SERVER_IP}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Deployment:</span>
                    <span className="text-indigo-400 font-mono">Vercel Edge Ready</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* 5. Production Setup Vercel Deployment Guide */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-xl mt-12" id="github-setup">
          <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
            <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-100">Step-by-Step Vercel Deployment & custom subdomains setup</h2>
              <p className="text-xs text-slate-400">Everything is fully pre-configured, including serverless routes inside <code className="text-indigo-300 text-[10px]">vercel.json</code>. Export to GitHub and connect easily!</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-slate-300">
            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
              <span className="inline-flex items-center justify-center bg-indigo-500/10 text-indigo-400 rounded-full h-7 w-7 text-xs font-bold mb-3">1</span>
              <h4 className="font-bold text-slate-200 mb-1.5">How To Export File Tree to GitLab/GitHub</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Connect your workspace project directly using the <strong className="text-slate-200">GitHub Menus in Google AI Studio</strong> or download the complete ZIP archive to your local device.
              </p>
            </div>

            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
              <span className="inline-flex items-center justify-center bg-indigo-500/10 text-indigo-400 rounded-full h-7 w-7 text-xs font-bold mb-3">2</span>
              <h4 className="font-bold text-slate-200 mb-1.5">Configure Routing mappings in lb-mapping.js</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Open <code className="text-indigo-300 font-mono text-[11px]">src/lb-mapping.js</code> on GitHub or local folder to update mappings easily. Serverless endpoints automatically read new values.
              </p>
            </div>

            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
              <span className="inline-flex items-center justify-center bg-indigo-500/10 text-indigo-400 rounded-full h-7 w-7 text-xs font-bold mb-3">3</span>
              <h4 className="font-bold text-slate-200 mb-1.5">Create free project on Vercel</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Link Vercel to your exported GitHub repository. The <code className="text-indigo-300 font-mono text-[11px]">vercel.json</code> deployment is already fully configured! It registers serverless rewrites inside Vercel edge functions.
              </p>
            </div>
          </div>

          <div className="bg-slate-950/40 p-5 rounded-lg border border-indigo-500/10 mt-6 font-mono text-xs text-indigo-300">
            <span className="font-sans font-bold text-slate-100 block mb-2">Vercel Deployment Parameters:</span>
            <ul className="space-y-1.5 text-[11px] list-disc pl-5">
              <li>Framework Preset: <span className="text-emerald-400">Create React App</span> / <span className="text-emerald-400">Vite SPA</span></li>
              <li>Root directory: <span className="text-slate-200">/</span></li>
              <li>Build Command: <span className="text-slate-200">npm run build</span></li>
              <li>Output Directory: <span className="text-slate-200">dist/</span></li>
              <li>Serverless route: <span className="text-cyan-400">/api/playlist</span> redirects dynamically to the Vercel edge processor.</li>
            </ul>
          </div>
        </section>

      </div>

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-900 py-6 text-center text-xs text-slate-500 mt-12">
        <p>© 2026 IPTV Playlist URL Rewriter App. Built with Google AI Studio.</p>
        <span className="text-[10px] mt-1 text-slate-600 font-mono block">Zero video stream components are proxied to avoid suspension. Custom subdomains only.</span>
      </footer>

    </div>
  );
}
