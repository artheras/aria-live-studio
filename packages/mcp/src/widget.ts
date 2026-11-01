/**
 * Inline round card for chat apps (ChatGPT, Claude) that render MCP tool UIs.
 *
 * One self-contained HTML document (inline CSS + JS, no network) exposed as
 * two resources, one per convention:
 *
 * - OpenAI Apps SDK: `ui://widget/aria-live-round.html`, mimeType
 *   `text/html+skybridge`, referenced by the tool's `_meta["openai/outputTemplate"]`.
 *   The page reads `window.openai.toolOutput` (the tool's structuredContent)
 *   and re-renders on the `openai:set_globals` event.
 * - MCP Apps (`io.modelcontextprotocol/ui`): `ui://aria-live/round.html`,
 *   mimeType `text/html;profile=mcp-app`, referenced by `_meta.ui.resourceUri`
 *   (and the legacy `_meta["ui/resourceUri"]`). The page speaks the JSON-RPC
 *   postMessage protocol: `ui/initialize` → `ui/notifications/initialized`,
 *   then renders `ui/notifications/tool-result` and follows
 *   `ui/notifications/host-context-changed` (theme).
 *
 * Viewer text is only ever put in the DOM with textContent.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const OPENAI_WIDGET_URI = "ui://widget/aria-live-round.html";
export const OPENAI_WIDGET_MIME = "text/html+skybridge";
export const MCP_APP_WIDGET_URI = "ui://aria-live/round.html";
export const MCP_APP_WIDGET_MIME = "text/html;profile=mcp-app";
/** MCP Apps protocol version the widget announces in ui/initialize. */
export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

/** Tool `_meta` that attaches the round card (both conventions). */
export function widgetToolMeta(invoking: string, invoked: string): Record<string, unknown> {
  return {
    ui: { resourceUri: MCP_APP_WIDGET_URI },
    "ui/resourceUri": MCP_APP_WIDGET_URI,
    "openai/outputTemplate": OPENAI_WIDGET_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    "openai/widgetAccessible": false,
  };
}

const CSS = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#14141a;--muted:#6b6b78;--line:#e4e4ea;--bar:#ececf2;--accent:#7c4dff;--win:#17a34a;--warn:#c27c0e;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#17171c;--fg:#f1f1f5;--muted:#a0a0ad;--line:#2c2c35;--bar:#2a2a33;--accent:#a78bfa;--win:#4ade80;--warn:#fbbf24}}
:root[data-theme=dark]{--bg:#17171c;--fg:#f1f1f5;--muted:#a0a0ad;--line:#2c2c35;--bar:#2a2a33;--accent:#a78bfa;--win:#4ade80;--warn:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--fg)}
.card{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px;max-width:640px}
.head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.title{font-weight:600}.pill{font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.pill.live{border-color:var(--accent);color:var(--accent)}.right{margin-left:auto;color:var(--muted);font-size:12px}
.theme{color:var(--muted);margin:4px 0 0}.msg{margin:8px 0 0;font-size:13px}
ol{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}
li .row{display:flex;gap:8px;align-items:baseline}.num{font-variant-numeric:tabular-nums;color:var(--muted);min-width:1.6em}
.txt{flex:1;overflow-wrap:anywhere}.cnt{font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap;font-size:12px}
.bar{height:6px;border-radius:3px;background:var(--bar);margin:3px 0 0 2.1em;overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent);border-radius:3px}
li.win .bar>i{background:var(--win)}li.win .txt{font-weight:600}
.foot{margin-top:10px;padding-top:8px;border-top:1px solid var(--line);display:grid;gap:3px;font-size:13px}
.k{color:var(--muted)}.empty{color:var(--muted);margin:8px 0 0}.note{color:var(--muted);font-size:11px;margin-top:8px}
`;

/* Plain ES2017, no dependencies. Kept small: it runs in a sandboxed iframe. */
const JS = `
(function(){
  var PHASE={none:"No round",idle:"No round",collecting:"Collecting ideas",voting:"Voting",decided:"Vote closed",planning:"Aria is planning",awaiting_approval:"Waiting for approval",executing:"Building",done:"Done",rejected:"Task rejected"};
  var root=document.getElementById("root");var data=null;var timer=null;
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e;}
  function setTheme(t){if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}
  function num(v){return typeof v==="number"&&isFinite(v)?v:0;}
  function render(){
    if(timer){clearTimeout(timer);timer=null;}
    root.textContent="";
    var d=data;var card=el("div","card");root.appendChild(card);
    if(!d||typeof d!=="object"){card.appendChild(el("div","empty","Waiting for the round…"));return size();}
    var head=el("div","head");card.appendChild(head);
    head.appendChild(el("span","title",d.roundIndex==null?"Aria Live":"Round #"+d.roundIndex));
    var phase=String(d.phase||"none");
    head.appendChild(el("span","pill"+(phase==="voting"||phase==="collecting"||phase==="executing"?" live":""),PHASE[phase]||phase));
    var right="";
    if(phase==="voting"&&typeof d.votingEndsAt==="number"){var s=Math.max(0,Math.round((d.votingEndsAt-Date.now())/1000));right=s>0?"ends in "+s+"s":"closing…";timer=setTimeout(render,1000);}
    else if(d.channel)right=(d.connected?"":"offline · ")+d.channel;
    if(right)head.appendChild(el("span","right",right));
    if(d.prompt)card.appendChild(el("p","theme",d.prompt));
    if(d.message)card.appendChild(el("p","msg",d.message));
    var ballot=Array.isArray(d.ballot)?d.ballot:[];
    var winNo=d.winner&&typeof d.winner==="object"?d.winner.number:null;
    if(ballot.length){
      var total=0;ballot.forEach(function(b){total+=num(b&&b.votes);});
      var ol=el("ol");card.appendChild(ol);
      ballot.forEach(function(b){
        if(!b||typeof b!=="object")return;var v=num(b.votes);var pct=total?Math.round(v*100/total):0;
        var li=el("li",b.number===winNo?"win":"");var row=el("div","row");
        row.appendChild(el("span","num",b.number+"."));row.appendChild(el("span","txt",b.text||""));
        row.appendChild(el("span","cnt",v+(v===1?" vote":" votes")+" · "+pct+"%"));
        var bar=el("div","bar");var fill=el("i");fill.style.width=pct+"%";bar.appendChild(fill);
        li.appendChild(row);li.appendChild(bar);ol.appendChild(li);
      });
    }else if(phase==="collecting"){card.appendChild(el("p","empty",num(d.ideaCount)+" idea(s) so far: the ballot appears when the vote starts."));}
    var foot=el("div","foot");var any=false;
    function line(k,v){var p=el("div");p.appendChild(el("span","k",k+" "));p.appendChild(el("span","",v));foot.appendChild(p);any=true;}
    if(typeof d.voters==="number"&&(ballot.length||d.voters))line("Voters","" + d.voters);
    if(d.winner&&typeof d.winner==="object")line("Winner","#"+d.winner.number+" "+(d.winner.text||"")+" ("+num(d.winner.votes)+" votes)");
    if(d.task&&typeof d.task==="object")line("Task",(d.task.title||"")+" · "+(d.task.status||""));
    if(d.execution&&typeof d.execution==="object")line("Build",(d.execution.status||"")+(d.execution.executor?" · "+d.execution.executor:""));
    if(any)card.appendChild(foot);
    card.appendChild(el("div","note","Ideas are written by viewers. Approvals happen on the Aria Live dashboard."));
    size();
  }
  function show(sc){if(sc&&typeof sc==="object"){data=sc;render();}}
  // ── OpenAI Apps SDK (window.openai) ──
  function fromOpenAI(){var o=window.openai;if(!o)return;if(o.theme)setTheme(o.theme);if(o.toolOutput)show(o.toolOutput);}
  window.addEventListener("openai:set_globals",function(e){var g=e&&e.detail&&e.detail.globals;if(g){if(g.theme)setTheme(g.theme);if(g.toolOutput)show(g.toolOutput);}else fromOpenAI();});
  // ── MCP Apps (JSON-RPC over postMessage with the host) ──
  var parentWin=window.parent;var nextId=1;var initId=null;
  function post(msg){try{if(parentWin&&parentWin!==window)parentWin.postMessage(msg,"*");}catch(_){}}
  function ctx(c){if(c&&typeof c==="object"&&c.theme)setTheme(c.theme);}
  var lastH=0;
  function size(){var h=Math.ceil(document.documentElement.scrollHeight||0);if(h&&h!==lastH){lastH=h;post({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{height:h}});}}
  window.addEventListener("message",function(e){
    if(e.source!==parentWin)return;var m=e.data;if(!m||typeof m!=="object"||m.jsonrpc!=="2.0")return;
    if(m.id!=null&&m.id===initId&&("result" in m||"error" in m)){
      if(m.result){ctx(m.result.hostContext);post({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}});}
      return;
    }
    if(m.method==="ui/notifications/tool-result"){var p=m.params||{};show(p.structuredContent);return;}
    if(m.method==="ui/notifications/host-context-changed"){ctx(m.params);return;}
    if(m.method&&m.id!=null){post({jsonrpc:"2.0",id:m.id,result:{}});} // ping, ui/resource-teardown
  });
  if(parentWin&&parentWin!==window&&!window.openai){
    initId=nextId++;
    post({jsonrpc:"2.0",id:initId,method:"ui/initialize",params:{appInfo:{name:"aria-live-round",version:"0.1.0"},appCapabilities:{},protocolVersion:"${MCP_APP_PROTOCOL_VERSION}"}});
  }
  fromOpenAI();
  if(!data)render();
})();
`;

export const ROUND_WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aria Live round</title><style>${CSS.trim()}</style></head>
<body><div id="root"></div><script>${JS.trim()}</script></body></html>
`;

const DESCRIPTION = "Live Aria Live round card: phase, theme, ballot with vote bars, voters, winner and task status.";

/** Registers the round card under both conventions. Safe to call once per server. */
export function registerRoundWidget(server: McpServer): void {
  server.registerResource(
    "aria-live-round-openai",
    OPENAI_WIDGET_URI,
    {
      title: "Aria Live round card",
      description: DESCRIPTION,
      mimeType: OPENAI_WIDGET_MIME,
      _meta: {
        "openai/widgetDescription": "Shows the current Aria Live round: ballot, votes, winner and task status.",
        "openai/widgetPrefersBorder": true,
        "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
      },
    },
    async () => ({
      contents: [
        {
          uri: OPENAI_WIDGET_URI,
          mimeType: OPENAI_WIDGET_MIME,
          text: ROUND_WIDGET_HTML,
          _meta: {
            "openai/widgetDescription": "Shows the current Aria Live round: ballot, votes, winner and task status.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
          },
        },
      ],
    }),
  );
  server.registerResource(
    "aria-live-round",
    MCP_APP_WIDGET_URI,
    {
      title: "Aria Live round card",
      description: DESCRIPTION,
      mimeType: MCP_APP_WIDGET_MIME,
      _meta: { ui: { prefersBorder: true } },
    },
    async () => ({
      contents: [{ uri: MCP_APP_WIDGET_URI, mimeType: MCP_APP_WIDGET_MIME, text: ROUND_WIDGET_HTML, _meta: { ui: { prefersBorder: true } } }],
    }),
  );
}
