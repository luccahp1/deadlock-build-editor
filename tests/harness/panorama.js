"use strict";
// A small stand-in for Valve's Panorama UI runtime, enough to run the mod's
// real script and layout under Node.js. It models the parts of Panorama the
// mod depends on, including the quirks recorded in HANDOFF.md:
//
// - camelCase inline style names are aliases and cannot be unset; clear the
//   CSS name (`margin`, `padding`, `position`, `align`, `flow-children`, ...);
// - clearing `visibility` leaves a panel hidden;
// - DeleteAsync removes a panel on a later frame, so it can still be found
//   by id until then;
// - calling into a deleted panel is an error.
//
// It does not lay anything out or render: sizes are whatever a test sets.

const util = require("util");
const vm = require("vm");

const STYLE_GROUPS = {
    margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
    padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
    position: ["x", "y"],
    align: ["horizontal-align", "vertical-align"],
};

function kebab(prop) {
    return prop.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
}

class PanelDeletedError extends Error {}

class Panel {
    constructor(runtime, paneltype, id, origin) {
        this._rt = runtime;
        this._valid = true;
        this._parent = null;
        this._children = [];
        this._classes = new Set();
        this._styles = new Map();
        this._handlers = {};      // SetPanelEvent / layout attributes
        this._listeners = {};     // $.RegisterEventHandler
        this._origin = origin;    // "game", "layout" or "script"
        this.paneltype = paneltype;
        this.id = id || "";
        this.text = "";
        this.visible = true;
        this.hittest = true;
        this.enabled = true;
        this.draggable = false;
        this.actuallayoutwidth = 100;
        this.actuallayoutheight = 40;
        this.actualxoffset = 0;
        this.actualyoffset = 0;
        this.actualuiscale_x = 1;
        this.actualuiscale_y = 1;
        this.contentheight = 0;
        this.scrolloffset_y = 0;
        this.windowPos = { x: 0, y: 0 };
        this.style = this._styleProxy();
        runtime.allPanels.push(this);
    }

    _live() {
        if (!this._valid) {
            throw new PanelDeletedError(`call on deleted panel ${this.paneltype}#${this.id}`);
        }
    }

    _styleProxy() {
        const panel = this;
        return new Proxy({}, {
            get(_, prop) {
                if (typeof prop !== "string") {
                    return undefined;
                }
                return panel._styles.get(kebab(prop));
            },
            set(_, prop, value) {
                panel._live();
                panel._rt.styleWrites++;
                const key = kebab(prop);
                if (value === null || value === undefined) {
                    if (/[A-Z]/.test(prop)) {
                        // Panorama quirk: aliases cannot be unset.
                        panel._rt.ignoredClears.push(`${panel.paneltype}#${panel.id}.${prop}`);
                        return true;
                    }
                    if (key === "visibility") {
                        // Panorama quirk: a cleared visibility stays hidden.
                        panel._styles.set("visibility", "collapse");
                        return true;
                    }
                    panel._styles.delete(key);
                    for (const member of STYLE_GROUPS[key] || []) {
                        panel._styles.delete(member);
                    }
                    return true;
                }
                panel._styles.set(key, String(value));
                return true;
            },
        });
    }

    inlineStyles() {
        return Object.fromEntries(this._styles);
    }

    IsValid() {
        return this._valid;
    }

    GetParent() {
        this._live();
        return this._parent;
    }

    Children() {
        this._live();
        return this._children.slice();
    }

    GetChildCount() {
        this._live();
        return this._children.length;
    }

    GetChild(index) {
        this._live();
        return this._children[index] || null;
    }

    FindChild(id) {
        this._live();
        return this._children.find(c => c.id === id) || null;
    }

    FindChildTraverse(id) {
        this._live();
        for (const child of this._children) {
            if (child.id === id) {
                return child;
            }
            const found = child.FindChildTraverse(id);
            if (found) {
                return found;
            }
        }
        return null;
    }

    FindChildrenWithClassTraverse(name) {
        this._live();
        const out = [];
        const walk = p => {
            for (const c of p._children) {
                if (c._classes.has(name)) {
                    out.push(c);
                }
                walk(c);
            }
        };
        walk(this);
        return out;
    }

    BHasClass(name) {
        this._live();
        return this._classes.has(name);
    }

    AddClass(name) {
        this._live();
        this._classes.add(name);
    }

    RemoveClass(name) {
        this._live();
        this._classes.delete(name);
    }

    SetHasClass(name, on) {
        on ? this.AddClass(name) : this.RemoveClass(name);
    }

    ToggleClass(name) {
        this.SetHasClass(name, !this.BHasClass(name));
    }

    SetPanelEvent(name, handler) {
        this._live();
        this._handlers[name] = handler;
    }

    SetDraggable(on) {
        this._live();
        this.draggable = !!on;
    }

    SetFocus() {
        this._live();
        this._rt.focus = this;
    }

    BHasKeyFocus() {
        this._live();
        return this._rt.focus === this;
    }

    GetPositionWithinWindow() {
        this._live();
        return { x: this.windowPos.x, y: this.windowPos.y };
    }

    MoveChildBefore(child, before) {
        this._live();
        const list = this._children;
        list.splice(list.indexOf(child), 1);
        const at = before ? list.indexOf(before) : -1;
        list.splice(at < 0 ? 0 : at, 0, child);
    }

    MoveChildAfter(child, after) {
        this._live();
        const list = this._children;
        list.splice(list.indexOf(child), 1);
        const at = after ? list.indexOf(after) : -1;
        list.splice(at < 0 ? list.length : at + 1, 0, child);
    }

    RemoveAndDeleteChildren() {
        this._live();
        for (const child of this._children.slice()) {
            child._destroy();
        }
    }

    DeleteAsync(delay) {
        this._live();
        if (this._pendingDelete) {
            return;
        }
        this._pendingDelete = true;
        this._rt.schedule(delay || 0, () => {
            if (this._valid) {
                this._destroy();
            }
        }, "DeleteAsync");
    }

    _destroy() {
        for (const child of this._children.slice()) {
            child._destroy();
        }
        const parent = this._parent;
        if (parent) {
            const list = parent._children;
            list.splice(list.indexOf(this), 1);
            this._parent = null;
        }
        if (this._rt.focus === this) {
            // Assumed: focus falls back to the nearest panel still alive. A
            // panel with no parent leaves it pointing at nothing.
            this._rt.focus = parent && parent._valid ? parent : this._rt.LOST_FOCUS;
        }
        this._valid = false;
    }

    // ---- test helpers (not Panorama API) ----

    append(child) {
        child._parent = this;
        this._children.push(child);
        return child;
    }

    fire(eventName, ...args) {
        const handler = this._handlers[eventName];
        if (handler) {
            this._rt.runHandler(this, handler, args);
            return true;
        }
        return false;
    }

    // Failing assertions print panels; the full object graph is huge.
    [util.inspect.custom]() {
        return `<${this._valid ? "" : "deleted "}${this.path()}>`;
    }

    path() {
        const parts = [];
        for (let p = this; p; p = p._parent) {
            parts.unshift(p.id ? `${p.paneltype}#${p.id}` : p.paneltype);
        }
        return parts.join(" > ");
    }
}

class Runtime {
    constructor() {
        this.now = 0;
        this.queue = [];
        this.seq = 0;
        this.allPanels = [];
        this.logs = [];
        this.errors = [];
        this.ignoredClears = [];
        this.styleWrites = 0;
        this.focus = null;
        this.LOST_FOCUS = { lost: true };
        this.eventHandlers = [];  // (name, panel, args) => handled?
        this.unknownEvents = [];
        this.contextPanel = null;
        this.context = null;
    }

    // ---- scheduler (virtual clock) ----

    schedule(delay, fn, label) {
        const handle = ++this.seq;
        this.queue.push({ at: this.now + Math.max(0, delay), seq: handle, fn: fn, label: label || "Schedule" });
        return handle;
    }

    cancel(handle) {
        this.queue = this.queue.filter(e => e.seq !== handle);
    }

    pendingCount(label) {
        return this.queue.filter(e => !label || e.label === label).length;
    }

    // Runs everything due in the next `seconds` of game time.
    advance(seconds) {
        const end = this.now + seconds;
        for (;;) {
            this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
            const next = this.queue[0];
            if (!next || next.at > end) {
                break;
            }
            this.queue.shift();
            this.now = next.at;
            this.guard(next.label, next.fn);
        }
        this.now = end;
    }

    guard(label, fn) {
        try {
            return fn();
        } catch (e) {
            this.errors.push(`${label}: ${e && e.stack ? e.stack : e}`);
            return undefined;
        }
    }

    // ---- events ----

    // Layout attributes are strings: `Name( args )` is a Panorama event,
    // anything else is JavaScript run in the script's context.
    runHandler(panel, handler, args) {
        if (typeof handler === "function") {
            return this.guard(`handler on ${panel.path()}`, () => handler(...args));
        }
        const text = handler.trim().replace(/;$/, "");
        const call = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(text);
        if (call) {
            const argList = call[2].trim() ? call[2].split(",").map(a => a.trim().replace(/^'(.*)'$/, "$1")) : [];
            return this.dispatch(call[1], panel, ...argList.map(a => (/^-?\d+$/.test(a) ? Number(a) : a)));
        }
        return this.guard(`handler "${text}"`, () => vm.runInContext(text, this.context));
    }

    dispatch(name, panel, ...args) {
        if (panel && panel._valid === false) {
            throw new PanelDeletedError(`DispatchEvent ${name} on deleted panel`);
        }
        for (const handler of this.eventHandlers) {
            if (handler(name, panel, args)) {
                return;
            }
        }
        if (name === "Activated" && panel) {
            panel.fire("onactivate") || (args[0] === "mouse" && panel.fire("onmouseactivate"));
            return;
        }
        if (name === "DropInputFocus") {
            if (!panel || this.focus === panel) {
                this.focus = null;
            }
            return;
        }
        this.unknownEvents.push(name);
    }

    createPanel(type, parent, id, props) {
        if (parent && parent._valid === false) {
            throw new PanelDeletedError(`CreatePanel on deleted parent`);
        }
        const panel = new Panel(this, type, id, "script");
        if (props && props.placeholder) {
            panel.placeholder = props.placeholder;
        }
        if (parent) {
            parent.append(panel);
        }
        return panel;
    }

    // The `$` object scripts see.
    dollar() {
        const rt = this;
        return {
            GetContextPanel: () => rt.contextPanel,
            Msg: (...parts) => rt.logs.push(parts.join("")),
            Schedule: (delay, fn) => rt.schedule(delay, fn),
            CancelScheduled: handle => rt.cancel(handle),
            CreatePanel: (type, parent, id, props) => rt.createPanel(type, parent, id, props),
            DispatchEvent: (name, panel, ...args) => rt.dispatch(name, panel, ...args),
            RegisterEventHandler: (name, panel, fn) => {
                (panel._listeners[name] = panel._listeners[name] || []).push(fn);
            },
        };
    }

    // Loads a compiled-free script source into a fresh context.
    runScript(source, filename) {
        this.context = vm.createContext({ $: this.dollar(), console: console });
        vm.runInContext(source, this.context, { filename: filename });
    }
}

// ---- layout XML ----

function parseXml(text) {
    text = text.replace(/<!--[\s\S]*?-->/g, "");
    const root = { tag: "#document", attrs: {}, children: [] };
    const stack = [root];
    const tagRe = /<(\/?)([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
    let match;
    while ((match = tagRe.exec(text))) {
        const [, closing, tag, attrText, selfClosing] = match;
        if (closing) {
            const open = stack.pop();
            if (open.tag !== tag) {
                throw new Error(`layout: </${tag}> closes <${open.tag}>`);
            }
            continue;
        }
        const attrs = {};
        attrText.replace(/([\w.:-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => {
            attrs[k] = v;
        });
        const node = { tag: tag, attrs: attrs, children: [] };
        stack[stack.length - 1].children.push(node);
        if (!selfClosing) {
            stack.push(node);
        }
    }
    if (stack.length !== 1) {
        throw new Error(`layout: <${stack[stack.length - 1].tag}> is never closed`);
    }
    return root;
}

function buildPanels(rt, node, parent) {
    const panel = new Panel(rt, node.tag, node.attrs.id, "layout");
    for (const [name, value] of Object.entries(node.attrs)) {
        if (name === "class") {
            value.split(/\s+/).filter(Boolean).forEach(c => panel._classes.add(c));
        } else if (name === "text") {
            panel.text = value;
        } else if (name === "hittest") {
            panel.hittest = value !== "false";
        } else if (name.startsWith("on")) {
            panel._handlers[name] = value;
        }
    }
    if (parent) {
        parent.append(panel);
    }
    for (const child of node.children) {
        buildPanels(rt, child, panel);
    }
    return panel;
}

module.exports = { Runtime, Panel, PanelDeletedError, parseXml, buildPanels, kebab };
