import { useCallback, useEffect, useRef, useState } from "react";
import { payAndRetry } from "./lib/paywall.js";
import { MiniMarkdown } from "./components/Markdown.jsx";
import {
  Bolt,
  Wallet,
  Send,
  Lock,
  Layers,
  Check,
  X,
  CheckCircle,
  AlertTriangle,
  Cpu,
  Clock,
  Refresh,
  Copy,
  ArrowUpRight,
  Shield,
  Activity,
} from "./components/icons.jsx";
import {
  connectWallet,
  getWalletAddress,
  getBalance,
  freighterAvailable,
  fundFromFriendbot,
  shortAddr,
  explorerUrl,
  XLM_SAC,
} from "./lib/stellar.js";

const CONTRACT_EXPLORER = (id) =>
  `https://stellar.expert/explorer/testnet/contract/${id}`;

// Payment stages, in order. The active step is highlighted while the flow
// runs; completed steps show a check.
const STAGES = [
  { id: "requesting", label: "Request", icon: Send },
  { id: "payment-required", label: "Paywall", icon: Lock },
  { id: "signed", label: "Signed", icon: Shield },
  { id: "settling", label: "Settling", icon: Layers },
  { id: "success", label: "Delivered", icon: CheckCircle },
];

function StageStepper({ stage }) {
  if (!stage) return null;
  const active = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="stepper" role="status" aria-label={`Payment stage: ${stage}`}>
      {STAGES.map((s, i) => {
        const state = i < active ? "done" : i === active ? "active" : "pending";
        const Icon = s.icon;
        return (
          <div key={s.id} className={`step step-${state}`}>
            <span className="step-icon">{state === "done" ? <Check /> : <Icon />}</span>
            <span className="step-label">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{t.icon}</span>
          <div className="toast-body">
            <b>{t.title}</b>
            {t.message && <span>{t.message}</span>}
            {t.txUrl && (
              <a href={t.txUrl} target="_blank" rel="noreferrer">
                View transaction <ArrowUpRight />
              </a>
            )}
          </div>
          <button className="toast-x" onClick={t.dismiss} aria-label="Dismiss">
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (non-secure context); ignore.
    }
  };
  return (
    <button
      className="copy-btn"
      onClick={copy}
      title={copied ? "Copied" : "Copy to clipboard"}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {copied ? <Check /> : label === "text" ? "Copy" : <Copy />}
    </button>
  );
}

function ChallengeCard({ challenge, amountXlm }) {
  const { request } = challenge;
  return (
    <div className="card challenge-card">
      <div className="challenge-head">
        <span className="challenge-icon">
          <Lock />
        </span>
        <div>
          <b>402 Payment Required</b>
          <span>Approve the transfer in your wallet to continue</span>
        </div>
      </div>
      <div className="challenge-grid">
        <div className="challenge-item">
          <span>Amount</span>
          <b className="amount">
            {amountXlm} <small>XLM</small>
          </b>
        </div>
        <div className="challenge-item">
          <span>Asset</span>
          <b>XLM · SEP-41</b>
        </div>
        <div className="challenge-item">
          <span>Recipient</span>
          <b className="mono">
            {shortAddr(request.recipient)}
            <CopyButton value={request.recipient} />
          </b>
        </div>
        <div className="challenge-item">
          <span>Network</span>
          <b className="badge badge-testnet">Testnet</b>
        </div>
      </div>
      <p className="hint">
        Your wallet signs a SEP-41 transfer on the XLM Stellar Asset Contract. The
        gateway verifies the transfer on-chain before generating a response.
      </p>
    </div>
  );
}

function Receipt({ payment }) {
  return (
    <div className="receipt">
      <div className="receipt-row">
        <span className="receipt-dot" />
        <span>
          Paid {payment.amountXlm} XLM · verified on-chain
        </span>
      </div>
      {payment.payer && (
        <div className="receipt-row receipt-sub">
          <span>From</span>
          <span className="mono">{shortAddr(payment.payer)}</span>
        </div>
      )}
      {payment.txHash && (
        <div className="receipt-row receipt-sub">
          <span>Transaction</span>
          <span className="mono">
            <a
              href={payment.explorerUrl || explorerUrl(payment.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddr(payment.txHash)} <ArrowUpRight />
            </a>
          </span>
        </div>
      )}
    </div>
  );
}

function Message({ role, text, payment, meta }) {
  return (
    <div className={`msg msg-${role}`}>
      <div className="msg-meta">
        <span className="msg-avatar">{role === "user" ? <Send /> : <Cpu />}</span>
        <span className="msg-name">{role === "user" ? "You" : "AgentPay"}</span>
        {meta?.model && <span className="badge badge-model">{meta.model}</span>}
        <span className="msg-time">{meta?.time}</span>
      </div>
      <div className="msg-bubble">
        {role === "user" ? <p>{text}</p> : <MiniMarkdown text={text} />}
        {payment && <Receipt payment={payment} />}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="typing">
      <i />
      <i />
      <i />
      <span>Generating response</span>
    </div>
  );
}

function FaucetButton({ onClick }) {
  return (
    <button className="btn btn-ghost" onClick={onClick}>
      <Refresh /> Testnet faucet
    </button>
  );
}

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [freighterInstalled, setFreighterInstalled] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "This gateway answers a prompt only after a payment settles on Stellar testnet.\n\n" +
        "- Connect **Freighter** and switch it to the testnet network.\n" +
        "- If your balance is under 1 XLM, use the faucet to get testnet funds.\n" +
        "- Send a prompt - approve the micro-payment - and receive a verified answer.\n\n" +
        "Each request costs **0.05 XLM**, settles via the XLM Stellar Asset Contract (SEP-41), and is recorded on a Soroban contract.",
    },
  ]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState(null);
  const [stageInfo, setStageInfo] = useState(null);
  const [gateway, setGateway] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const endRef = useRef(null);

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [
      ...ts,
      { ...toast, id, dismiss: () => setToasts((ts) => ts.filter((t) => t.id !== id)) },
    ]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 6500);
  }, []);

  const refreshWallet = useCallback(async (address) => {
    const balance = await getBalance(address);
    setWallet((w) => ({ ...(w ?? {}), address, balance }));
  }, []);

  useEffect(() => {
    freighterAvailable()
      .then(setFreighterInstalled)
      .catch(() => setFreighterInstalled(false));
    getWalletAddress()
      .then((address) => {
        if (address) refreshWallet(address);
      })
      .catch(() => {});
    fetch("/api/health")
      .then((r) => r.json())
      .then(setGateway)
      .catch(() => {});
    fetch("/api/payments")
      .then((r) => r.json())
      .then((d) => setHistory(d.payments))
      .catch(() => {});
  }, [refreshWallet]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stage, stageInfo]);

  const handleConnect = async () => {
    setError(null);
    try {
      const address = await connectWallet();
      await refreshWallet(address);
      pushToast({
        type: "ok",
        icon: <Wallet />,
        title: "Wallet connected",
        message: shortAddr(address),
      });
    } catch (err) {
      setError(err.message);
      pushToast({ type: "err", icon: <AlertTriangle />, title: "Connection failed", message: err.message });
    }
  };

  const handleFriendbot = async () => {
    if (!wallet) return;
    setError(null);
    try {
      await fundFromFriendbot(wallet.address);
      pushToast({
        type: "ok",
        icon: <Refresh />,
        title: "Faucet request sent",
        message: "Testnet XLM is on its way",
      });
      await new Promise((r) => setTimeout(r, 2500));
      await refreshWallet(wallet.address);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDisconnect = () => {
    setWallet(null);
    pushToast({ type: "info", icon: <Wallet />, title: "Wallet disconnected" });
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || busyRef.current) return;
    if (!wallet) {
      setError("Connect a Freighter wallet on testnet first.");
      return;
    }

    setInput("");
    setError(null);
    setStage("requesting");
    setStageInfo(null);
    busyRef.current = true;
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: prompt, meta: { time: timeNow() } }]);

    try {
      const { status, ok, data } = await payAndRetry({
        url: "/api/ai/chat",
        body: { prompt },
        sourceAddress: wallet.address,
        onStage: (s, info) => {
          setStage(s);
          if (info) setStageInfo(info);
        },
      });

      if (!ok) {
        throw new Error(data.error || `Gateway error (HTTP ${status})`);
      }

      const response =
        data.response ?? "The gateway responded, but returned no content.";
      const payment = data.payment ?? null;

      setStage("success");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: response,
          payment,
          meta: { model: gateway?.aiModel, time: timeNow() },
        },
      ]);

      if (payment?.txHash) {
        pushToast({
          type: "ok",
          icon: <CheckCircle />,
          title: `Payment verified · ${payment.amountXlm} XLM`,
          message: "Answer delivered.",
          txUrl: payment.explorerUrl || explorerUrl(payment.txHash),
        });
      } else {
        pushToast({ type: "ok", icon: <CheckCircle />, title: "Answer delivered" });
      }

      setHistory((h) => [
        {
          requestId: payment?.requestId,
          amountXlm: payment?.amountXlm ?? gateway?.priceXlm,
          txHash: payment?.txHash ?? null,
          explorerUrl: payment?.explorerUrl ?? null,
          ts: new Date().toISOString(),
        },
        ...h,
      ]);
      await refreshWallet(wallet.address);
    } catch (err) {
      setStage("error");
      setError(err.message);
      pushToast({ type: "err", icon: <AlertTriangle />, title: "Request failed", message: err.message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const challenge = stageInfo?.challenge;
  const aiMode = gateway?.aiMode ?? "mock";

  return (
    <div className="app">
      <ToastStack toasts={toasts} />

      <header className="topbar">
        <div className="brand">
          <span className="logo">
            <Bolt />
          </span>
          <div>
            <h1>AgentPay</h1>
            <p className="tagline">AI agent payments on Stellar</p>
          </div>
        </div>
        <div className="topbar-right">
          <span
            className={`badge badge-mode badge-mode-${aiMode}`}
            title={`Provider: ${gateway?.aiProvider ?? "mock"} · model: ${gateway?.aiModel ?? "—"}`}
          >
            <Activity />
            {aiMode === "openai"
              ? "AI live"
              : aiMode === "openai-mock-fallback"
                ? "AI fallback"
                : "AI mock"}
          </span>
          <span className="badge badge-testnet">
            <span className="dot-live" /> Testnet
          </span>
          {wallet ? (
            <div className="wallet-chip">
              <span className="balance">{wallet.balance} XLM</span>
              <span className="mono">{shortAddr(wallet.address)}</span>
              <CopyButton value={wallet.address} />
              <button className="chip-x" onClick={handleDisconnect} title="Disconnect" aria-label="Disconnect wallet">
                <X />
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={handleConnect}>
              <Wallet /> {freighterInstalled ? "Connect wallet" : "Install Freighter"}
            </button>
          )}
        </div>
      </header>

      <main className="layout">
        <section className="chat">
          <div className="chat-head">
            <span className="chat-title">
              <span className="dot-online" /> Gateway connected
            </span>
            <span className="chat-sub">
              {gateway?.aiModel ?? "loading"} · {gateway?.priceXlm ?? "—"} XLM / request
            </span>
          </div>

          <div className="chat-scroll">
            {messages.map((m, i) => (
              <Message key={i} role={m.role} text={m.text} payment={m.payment} meta={m.meta} />
            ))}

            {busy && stage === "settling" && !challenge && (
              <div className="msg msg-assistant">
                <div className="msg-bubble">
                  <TypingIndicator />
                </div>
              </div>
            )}

            {stage && stage !== "success" && stage !== "error" && (
              <div className="msg msg-assistant">
                <div className="msg-bubble msg-bubble-stage">
                  <StageStepper stage={stage} />
                  {challenge && (
                    <ChallengeCard challenge={challenge} amountXlm={gateway?.priceXlm ?? "0.05"} />
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="error-banner">
                <AlertTriangle />
                <span>{error}</span>
              </div>
            )}

            <div ref={endRef} />
          </div>

          <div className="composer">
            <textarea
              id="prompt-input"
              name="prompt"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                wallet
                  ? "Ask anything - 0.05 XLM per request"
                  : "Connect a wallet to unlock the demo"
              }
              rows={2}
              disabled={busy}
            />
            <div className="composer-bar">
              <div className="composer-left">
                {wallet && Number(wallet.balance) < 1 && (
                  <FaucetButton onClick={handleFriendbot} />
                )}
                <span className="price-hint">0.05 XLM per answer</span>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={busy || !input.trim()}
              >
                {busy ? "Processing…" : "Send"}
                {!busy && <Send />}
              </button>
            </div>
          </div>
        </section>

        <aside className="panel">
          {wallet && (
            <div className="card wallet-card">
              <div className="card-title">
                <Wallet /> Wallet
              </div>
              <div className="wallet-balance">
                <b>{wallet.balance}</b> <span>XLM</span>
              </div>
              <div className="wallet-row">
                <span className="mono">{shortAddr(wallet.address)}</span>
                <CopyButton value={wallet.address} label="text" />
              </div>
              {Number(wallet.balance) < 1 && (
                <button className="btn btn-ghost btn-block" onClick={handleFriendbot}>
                  <Refresh /> Fund from faucet
                </button>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-title">
              <Activity /> Gateway
            </div>
            <div className="kv">
              <div className="kv-row">
                <span>Status</span>
                <span className="badge badge-ok">
                  <span className="dot-live" /> Online
                </span>
              </div>
              <div className="kv-row">
                <span>Price</span>
                <span>{gateway?.priceXlm ?? "—"} XLM</span>
              </div>
              <div className="kv-row">
                <span>AI mode</span>
                <span className="mono">{aiMode}</span>
              </div>
              <div className="kv-row">
                <span>Recipient</span>
                <span className="mono">
                  {gateway ? shortAddr(gateway.recipient) : "—"}
                  {gateway && <CopyButton value={gateway.recipient} />}
                </span>
              </div>
              <div className="kv-row">
                <span>Asset</span>
                <span className="mono" title={XLM_SAC}>
                  XLM SAC
                </span>
              </div>
              {gateway?.registryContractId && (
                <div className="kv-row">
                  <span>Contract</span>
                  <span className="mono">
                    <a
                      href={CONTRACT_EXPLORER(gateway.registryContractId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddr(gateway.registryContractId)} <ArrowUpRight />
                    </a>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <Layers /> Volume
            </div>
            <div className="stats">
              <div className="stat">
                <b>{gateway?.payments ?? 0}</b>
                <span>payments</span>
              </div>
              <div className="stat">
                <b>{gateway?.volumeXlm ?? "0"}</b>
                <span>XLM total</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <Clock /> Recent payments
            </div>
            {history.length === 0 ? (
              <p className="hint">No payments recorded yet.</p>
            ) : (
              <ul className="history">
                {history.slice(0, 8).map((p, i) => (
                  <li key={i}>
                    <span>
                      {p.amountXlm} XLM
                      <span className="history-time">
                        {new Date(p.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                    {p.txHash && (
                      <a
                        href={p.explorerUrl || explorerUrl(p.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(p.txHash)} <ArrowUpRight />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="footnote">
            Payments settle on Stellar testnet via the XLM Stellar Asset Contract (SEP-41)
            and are recorded on the PaymentRegistry Soroban contract.
          </p>
        </aside>
      </main>
    </div>
  );
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
