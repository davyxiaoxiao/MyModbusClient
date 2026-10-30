import { Icon } from "./Icon";
import {
  exceptionText,
  formatClock,
  functionName,
  logAddress,
} from "../format";
import type { LogEntry, Transport } from "../types";

interface RequestLogProps {
  logs: LogEntry[];
  collapsed: boolean;
  running: boolean;
  transport: Transport | "";
  onClear: () => void;
  onToggle: () => void;
}

export function RequestLog({
  logs,
  collapsed,
  running,
  transport,
  onClear,
  onToggle,
}: RequestLogProps) {
  const transportLabel =
    transport === "rtu" ? "RTU" : transport === "tcp" ? "TCP" : "";

  return (
    <section className={`log-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="log-head">
        <div className="log-head-left">
          <Icon name="activity" size={14} />
          <span className="log-title">请求记录</span>
          {running && <span className="live-dot" />}
          <span className="log-count">{logs.length} / 200</span>
          {transportLabel && (
            <span className="log-transport">{transportLabel}</span>
          )}
        </div>
        <div className="log-actions">
          <button
            type="button"
            className="icon-btn-dark"
            onClick={onClear}
            title="清空记录"
            aria-label="清空请求记录"
          >
            <Icon name="eraser" size={13} />
          </button>
          <button
            type="button"
            className={`icon-btn-dark ${collapsed ? "collapsed" : ""}`}
            onClick={onToggle}
            title={collapsed ? "展开记录" : "收起记录"}
            aria-label={collapsed ? "展开请求记录" : "收起请求记录"}
          >
            <Icon name="chevron" size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="log-body">
          {logs.length === 0 ? (
            <div className="log-empty">
              <Icon name="activity" size={24} />
              <p>等待主站请求…</p>
              <span>启动服务并连接客户端后，读写记录会显示在这里</span>
            </div>
          ) : (
            <>
              <div className="log-columns" aria-hidden="true">
                <span>时间</span>
                <span>功能</span>
                <span>操作</span>
                <span>地址</span>
                <span>来源</span>
                <span>结果 / 原因</span>
              </div>
              {logs.map((log) => (
                <LogRow key={log.seq} log={log} />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  const failed = !log.ok;
  const knownFunction = log.function > 0;
  const description = knownFunction
    ? functionName(log.function)
    : "无法识别的帧";
  const resultTitle = log.exception
    ? `${exceptionText(log.exception)}（异常 ${log.exception
        .toString(16)
        .padStart(2, "0")}）`
    : log.reason;

  return (
    <div className={`log-row ${failed ? "failed" : "ok"}`}>
      <span className="log-time">{formatClock(log.timeMs)}</span>
      <span className="fc-badge">
        {knownFunction
          ? `FC ${log.function.toString().padStart(2, "0")}`
          : "FC —"}
      </span>
      <span className="log-desc" title={description}>
        {description}
      </span>
      <span className="log-addr">{logAddress(log)}</span>
      <span className="log-client" title={log.client}>
        {log.client || "—"}
      </span>
      <span className="log-status">
        <span
          className={`log-result ${failed ? "err" : "ok"}`}
          title={resultTitle}
        >
          {failed ? "失败" : "成功"}
        </span>
        <span className="log-reason" title={log.reason || resultTitle}>
          {log.reason || "—"}
        </span>
      </span>
      <div className="log-frames">
        <div className="log-frame-line">
          <span className="frame-dir request">→ 请求</span>
          <span className="frame-hex">{log.requestHex || "—"}</span>
        </div>
        <div className={`log-frame-line ${failed ? "failed" : ""}`}>
          <span className="frame-dir response">← 响应</span>
          <span className={`frame-hex ${log.responseHex ? "" : "empty"}`}>
            {log.responseHex ?? "无响应"}
          </span>
        </div>
      </div>
    </div>
  );
}
