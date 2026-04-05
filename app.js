class StateStore {
    constructor() { this.reset(); }
    reset() {
        this.frames = [{ id: 1, name: 'Frame 1', players: [], lines: [] }];
        this.currentIdx = 0;
        this.history = [];
        this.historyIdx = -1;
        this.nextId = 100;
    }
    get f() { return this.frames[this.currentIdx]; }
    save() {
        this.history = this.history.slice(0, this.historyIdx + 1);
        this.history.push(structuredClone(this.frames));
        if (this.history.length > 20) this.history.shift(); 
        else this.historyIdx++;
    }
    undo() {
        if (this.historyIdx > 0) {
            this.historyIdx--;
            this.frames = structuredClone(this.history[this.historyIdx]);
            this.currentIdx = Math.min(this.currentIdx, this.frames.length - 1);
            return true;
        }
        return false;
    }
}

class Viewport {
    constructor(canvas, app) {
        this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.app = app;
        this.x = 0; this.y = 0; this._scale = 1;
        this.dpr = window.devicePixelRatio || 1;
        this.width = 0; this.height = 0;
        
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if(entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                    this.resize(entry.contentRect.width, entry.contentRect.height);
                    if(this.width === entry.contentRect.width && !this.initialized) {
                        this.centerOn(400, 500); this.initialized = true;
                    }
                    if(this.app) this.app.scheduleRender();
                }
            }
        });
        this.resizeObserver.observe(this.canvas.parentElement);
    }
    get scale() { return this._scale; }
    set scale(val) { this._scale = Math.max(0.4, Math.min(val, 4.0)); }

    resize(w, h) {
        this.width = w; this.height = h;
        this.canvas.width = this.width * this.dpr; this.canvas.height = this.height * this.dpr;
        this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
    }
    clamp() {
        const fieldCenterX = 400 * this.scale + this.x; const fieldCenterY = 400 * this.scale + this.y;
        const marginX = this.width * 0.4; const marginY = this.height * 0.4;
        const minCx = -marginX; const maxCx = this.width + marginX;
        const minCy = -marginY; const maxCy = this.height + marginY;
        let targetCx = Math.max(minCx, Math.min(maxCx, fieldCenterX));
        let targetCy = Math.max(minCy, Math.min(maxCy, fieldCenterY));
        this.x = targetCx - 400 * this.scale; this.y = targetCy - 400 * this.scale;
    }
    centerOn(worldX, worldY) {
        this.x = (this.width / 2) - (worldX * this.scale); this.y = (this.height / 2) - (worldY * this.scale);
        this.clamp();
    }
    screenToWorld(screenX, screenY) { return { x: (screenX - this.x) / this.scale, y: (screenY - this.y) / this.scale }; }
    worldToScreen(worldX, worldY) { return { x: (worldX * this.scale) + this.x, y: (worldY * this.scale) + this.y }; }
    apply() { this.ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.x * this.dpr, this.y * this.dpr); }
    resetToScreenSpace() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
}

class Renderer {
    constructor(ctx, viewport, config) {
        this.ctx = ctx; this.vp = viewport; this.cfg = config; this.pathCache = new Map();
        const cx = 400, cy = 720, s = 2.8;
        this.GEO = {
            HOME: {x: cx, y: cy}, MOUND: {x: cx, y: cy - (46 * s)},
            B1: {x: cx + (60 * s * Math.cos(Math.PI/4)), y: cy - (60 * s * Math.sin(Math.PI/4))},
            B2: {x: cx, y: cy - (60 * s * Math.sqrt(2))},
            B3: {x: cx - (60 * s * Math.cos(Math.PI/4)), y: cy - (60 * s * Math.sin(Math.PI/4))}
        };
        this.COLORS = { fair: '#16a34a', dirt: '#b45309', run: '#f59e0b', throw: '#ffffff', hit: '#f97316' };
    }
    clearCache() { this.pathCache.clear(); }
    getVisualRadius(player) { return player.type === 'ball' ? this.cfg.radius * 0.7 : this.cfg.radius; }
    
    draw(state, inputIx, progress = null, animFrame = null) {
        this.vp.resetToScreenSpace();
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        this.vp.apply();
        this.drawField();

        const isAnim = progress !== null;
        const frame = isAnim ? animFrame : state.f;
        const lines = isAnim ? frame.lines : [...frame.lines, inputIx.drawingLine].filter(Boolean);
        lines.forEach(l => this.drawLine(l, isAnim ? progress : 1, inputIx));

        this.vp.resetToScreenSpace();
        const entities = [...frame.players].sort((a,b) => a.type === 'ball' ? 1 : -1);
        entities.forEach(p => {
            let pos = {x: p.x, y: p.y};
            if(isAnim) pos = this.calcAnimPos(p, frame.lines, progress);
            const screenPos = this.vp.worldToScreen(pos.x, pos.y);
            this.drawToken(screenPos.x, screenPos.y, p, inputIx.activeEntity?.id === p.id && !isAnim);
        });
    }

    drawField() {
        const c = this.ctx, F = 200 * this.cfg.scale;
        c.save(); c.beginPath(); c.moveTo(this.GEO.HOME.x, this.GEO.HOME.y);
        c.lineTo(this.GEO.HOME.x - F*Math.sin(Math.PI/4), this.GEO.HOME.y - F*Math.cos(Math.PI/4));
        c.arc(this.GEO.HOME.x, this.GEO.HOME.y, F, Math.PI*1.25, Math.PI*1.75);
        c.lineTo(this.GEO.HOME.x, this.GEO.HOME.y); c.clip();
        c.fillStyle = this.COLORS.fair; c.fill();
        c.beginPath(); c.arc(this.GEO.MOUND.x, this.GEO.MOUND.y, 50 * this.cfg.scale, 0, Math.PI*2);
        c.fillStyle = this.COLORS.dirt; c.fill();
        c.beginPath(); const ins = 3 * this.cfg.scale;
        c.moveTo(this.GEO.HOME.x, this.GEO.HOME.y - 12*this.cfg.scale); c.lineTo(this.GEO.B1.x - ins, this.GEO.B1.y);
        c.lineTo(this.GEO.B2.x, this.GEO.B2.y + ins); c.lineTo(this.GEO.B3.x + ins, this.GEO.B3.y);
        c.fillStyle = this.COLORS.fair; c.fill();
        [this.GEO.HOME, this.GEO.MOUND, this.GEO.B1, this.GEO.B2, this.GEO.B3].forEach(b => { c.beginPath(); c.arc(b.x, b.y, 8 * this.cfg.scale, 0, Math.PI*2); c.fillStyle = this.COLORS.dirt; c.fill(); });
        c.restore();

        c.beginPath(); c.moveTo(this.GEO.HOME.x, this.GEO.HOME.y); c.lineTo(this.GEO.HOME.x - F*Math.sin(Math.PI/4), this.GEO.HOME.y - F*Math.cos(Math.PI/4));
        c.moveTo(this.GEO.HOME.x, this.GEO.HOME.y); c.lineTo(this.GEO.HOME.x + F*Math.sin(Math.PI/4), this.GEO.HOME.y - F*Math.cos(Math.PI/4));
        c.strokeStyle = '#cbd5e1'; c.lineWidth = 2; c.stroke();

        c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
        [this.GEO.B1, this.GEO.B2, this.GEO.B3].forEach(b => { c.beginPath(); const size = 6; c.moveTo(b.x, b.y - size); c.lineTo(b.x + size, b.y); c.lineTo(b.x, b.y + size); c.lineTo(b.x - size, b.y); c.closePath(); c.fill(); c.stroke(); });

        c.beginPath(); const hp = 6;
        c.moveTo(this.GEO.HOME.x, this.GEO.HOME.y); c.lineTo(this.GEO.HOME.x - hp, this.GEO.HOME.y - hp); c.lineTo(this.GEO.HOME.x - hp, this.GEO.HOME.y - hp*2);
        c.lineTo(this.GEO.HOME.x + hp, this.GEO.HOME.y - hp*2); c.lineTo(this.GEO.HOME.x + hp, this.GEO.HOME.y - hp); c.closePath(); c.fill(); c.stroke();
        c.fillRect(this.GEO.MOUND.x - 6, this.GEO.MOUND.y - 2, 12, 4); c.strokeRect(this.GEO.MOUND.x - 6, this.GEO.MOUND.y - 2, 12, 4);
    }

    generateLinePath(l, progress = 1, inputIx = null) {
        const isDrawing = (l === inputIx?.drawingLine); const isAnim = progress !== null && progress < 1;
        if (!isDrawing && !isAnim && this.pathCache.has(l.id)) return this.pathCache.get(l.id);
        const p2d = new Path2D(); p2d.moveTo(l.start.x, l.start.y);
        const actEnd = { x: l.start.x + (l.end.x - l.start.x) * progress, y: l.start.y + (l.end.y - l.start.y) * progress };
        if(isDrawing) { actEnd.x = inputIx.mouseX; actEnd.y = inputIx.mouseY; }

        if (l.type === 'run') {
            const dist = Math.hypot(actEnd.x - l.start.x, actEnd.y - l.start.y);
            const ang = Math.atan2(actEnd.y - l.start.y, actEnd.x - l.start.x);
            for(let i=0; i<dist; i+=4) p2d.lineTo(l.start.x + Math.cos(ang)*i + Math.cos(ang+Math.PI/2)*Math.sin(i*0.3)*4, l.start.y + Math.sin(ang)*i + Math.sin(ang+Math.PI/2)*Math.sin(i*0.3)*4);
        } else if (l.type === 'throw') { p2d.lineTo(actEnd.x, actEnd.y); } 
        else if (l.type === 'hit') {
            const cp = this.getArcCP(l.start, isDrawing ? actEnd : l.end);
            for(let t=0; t<=progress; t+=0.02) { const pt = this.getBezier(t, l.start, cp, isDrawing ? actEnd : l.end); p2d.lineTo(pt.x, pt.y); }
        }
        if (!isDrawing && !isAnim) this.pathCache.set(l.id, p2d);
        return p2d;
    }

    drawLine(l, p, inputIx) {
        const c = this.ctx; const p2d = this.generateLinePath(l, p, inputIx);
        if (l.type === 'run') { c.strokeStyle = this.COLORS.run; c.lineWidth = 4; } 
        else if (l.type === 'throw') { c.strokeStyle = this.COLORS.throw; c.lineWidth = 3; c.setLineDash([8,6]); } 
        else if (l.type === 'hit') { c.strokeStyle = this.COLORS.hit; c.lineWidth = 4; c.setLineDash([12,8]); }
        c.stroke(p2d); c.setLineDash([]);
    }

    drawToken(screenX, screenY, p, isActive) {
        const c = this.ctx; const radius = this.getVisualRadius(p);
        c.beginPath(); c.arc(screenX, screenY, radius, 0, Math.PI*2);
        c.fillStyle = p.type === 'ball' ? '#fff' : (p.type === 'off' ? '#ef4444' : '#3b82f6'); c.fill(); 
        c.strokeStyle = p.type === 'ball' ? '#ef4444' : '#000'; c.lineWidth = 2; c.stroke();
        c.fillStyle = p.type === 'ball' ? '#000' : '#fff'; c.font = p.type === 'ball' ? '12px sans-serif' : 'bold 12px sans-serif'; 
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(p.label, screenX, screenY);
        if(isActive) { c.beginPath(); c.arc(screenX, screenY, radius+4, 0, Math.PI*2); c.fillStyle = 'rgba(255,255,255,0.2)'; c.fill(); }
    }

    getArcCP(s, e) { return { x: (s.x+e.x)/2 + (e.x-this.GEO.HOME.x)*0.3, y: (s.y+e.y)/2 - Math.hypot(e.x-s.x, e.y-s.y)*0.8 - 60 }; }
    getBezier(t, s, cp, e) { return { x: (1-t)**2 * s.x + 2*(1-t)*t * cp.x + t**2 * e.x, y: (1-t)**2 * s.y + 2*(1-t)*t * cp.y + t**2 * e.y }; }
    calcAnimPos(p, lines, progress) {
        const l = lines.find(line => line.startId === p.id); if(!l) return {x: p.x, y: p.y};
        if(l.type === 'hit') return this.getBezier(progress, l.start, this.getArcCP(l.start, l.end), l.end);
        return { x: l.start.x + (l.end.x - l.start.x) * progress, y: l.start.y + (l.end.y - l.start.y) * progress };
    }
}

class InputHandler {
    constructor(canvas, viewport, state, renderer, app) {
        this.canvas = canvas; this.vp = viewport; this.state = state; this.renderer = renderer; this.app = app;
        this.ix = { activeEntity: null, drawingLine: null, draggingPlayer: null, panStart: null, mouseX: 0, mouseY: 0, startScreenX: 0, startScreenY: 0 };
        this.keys = {}; this.pointers = new Map();
        
        this.canvas.addEventListener('contextmenu', e => e.preventDefault()); 
        
        this._boundDown = this.onPointerDown.bind(this);
        this._boundMove = this.onPointerMove.bind(this);
        this._boundUp = this.onPointerUp.bind(this);
        
        this.canvas.addEventListener('pointerdown', this._boundDown);
        window.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            if(e.code === 'Escape') {
                if(this.ix.drawingLine) { this.ix.drawingLine = null; this.detachGlobalMove(); this.app.scheduleRender(); }
                this.app.closeRadial();
            }
        });
        window.addEventListener('keyup', e => this.keys[e.code] = false);
        
        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const zoomFactor = Math.max(0.95, Math.min(1.05, Math.exp(-e.deltaY * 0.002)));
            this.zoomAt(e.clientX, e.clientY, zoomFactor);
        }, { passive: false });
    }

    zoomAt(screenX, screenY, zoomDelta) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = screenX - rect.left; const mouseY = screenY - rect.top;
        const worldPos = this.vp.screenToWorld(mouseX, mouseY);
        this.vp.scale *= zoomDelta;
        this.vp.x = mouseX - (worldPos.x * this.vp.scale); this.vp.y = mouseY - (worldPos.y * this.vp.scale);
        this.vp.clamp(); this.app.scheduleRender();
    }

    attachGlobalMove() { document.addEventListener('pointermove', this._boundMove); }
    detachGlobalMove() { if(this.pointers.size === 0 && !this.ix.drawingLine) document.removeEventListener('pointermove', this._boundMove); }
    getMidpoint(p1, p2) { return { x: (p1.x + p2.x)/2, y: (p1.y + p2.y)/2 }; }
    getDistance(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }

    onPointerDown(e) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.attachGlobalMove(); document.addEventListener('pointerup', this._boundUp);

        if (this.pointers.size === 2) {
            const pts = Array.from(this.pointers.values());
            this.pinchStartDist = this.getDistance(pts[0], pts[1]);
            this.pinchStartScale = this.vp.scale;
            this.panStartMid = this.getMidpoint(pts[0], pts[1]);
            this.panStartVP = { x: this.vp.x, y: this.vp.y };
            this.ix.draggingPlayer = null; 
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left; const screenY = e.clientY - rect.top;
        const worldPos = this.vp.screenToWorld(screenX, screenY);
        this.ix.startScreenX = screenX; this.ix.startScreenY = screenY;

        if (this.keys['Space'] || e.button === 1 || e.button === 2) {
            this.ix.panStart = { x: screenX, y: screenY, vpX: this.vp.x, vpY: this.vp.y };
            this.canvas.parentElement.classList.add('panning');
            return;
        }

        if (this.ix.drawingLine) {
            this.ix.drawingLine.end = worldPos;
            this.state.f.lines.push(this.ix.drawingLine);
            this.ix.drawingLine = null;
            this.state.save(); this.app.scheduleRender();
            this.detachGlobalMove(); return;
        }

        const hitPlayer = [...this.state.f.players].reverse().find(p => {
            const pScreen = this.vp.worldToScreen(p.x, p.y);
            return Math.hypot(screenX - pScreen.x, screenY - pScreen.y) <= (this.renderer.getVisualRadius(p) + 8);
        });

        if (hitPlayer) { 
            this.ix.draggingPlayer = hitPlayer; 
            this.app.closeRadial(); 
            return; 
        }

        this.renderer.vp.apply(); this.renderer.ctx.lineWidth = 20 / this.vp.scale; 
        for (let i = this.state.f.lines.length - 1; i >= 0; i--) {
            const l = this.state.f.lines[i]; const p2d = this.renderer.generateLinePath(l);
            if (this.renderer.ctx.isPointInStroke(p2d, screenX * this.vp.dpr, screenY * this.vp.dpr)) {
                this.state.f.lines.splice(i, 1);
                this.renderer.clearCache(); 
                this.state.save(); this.app.scheduleRender(); return;
            }
        }

        this.app.closeRadial();
        this.ix.panStart = { x: screenX, y: screenY, vpX: this.vp.x, vpY: this.vp.y };
        this.canvas.parentElement.classList.add('panning');
    }

    onPointerMove(e) {
        if(this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const rect = this.canvas.getBoundingClientRect();
        
        if (this.pointers.size === 2) {
            const pts = Array.from(this.pointers.values());
            const currentDist = this.getDistance(pts[0], pts[1]); const currentMid = this.getMidpoint(pts[0], pts[1]);
            const rawTargetScale = this.pinchStartScale * (currentDist / this.pinchStartDist);
            const smoothedScale = this.vp.scale + (rawTargetScale - this.vp.scale) * 0.4;
            
            const startMidScreenX = this.panStartMid.x - rect.left; const startMidScreenY = this.panStartMid.y - rect.top;
            const worldPivotX = (startMidScreenX - this.panStartVP.x) / this.pinchStartScale;
            const worldPivotY = (startMidScreenY - this.panStartVP.y) / this.pinchStartScale;
            
            this.vp.scale = smoothedScale;
            const currentMidScreenX = currentMid.x - rect.left; const currentMidScreenY = currentMid.y - rect.top;
            this.vp.x = currentMidScreenX - (worldPivotX * this.vp.scale); this.vp.y = currentMidScreenY - (worldPivotY * this.vp.scale);
            this.vp.clamp(); this.app.scheduleRender(); return;
        }

        const screenX = e.clientX - rect.left; const screenY = e.clientY - rect.top;

        if (this.ix.panStart) {
            this.vp.x = this.ix.panStart.vpX + (screenX - this.ix.panStart.x); 
            this.vp.y = this.ix.panStart.vpY + (screenY - this.ix.panStart.y);
            this.vp.clamp(); this.app.scheduleRender(); return;
        }

        const worldPos = this.vp.screenToWorld(screenX, screenY);
        this.ix.mouseX = worldPos.x; this.ix.mouseY = worldPos.y;

        if (this.ix.draggingPlayer) { this.ix.draggingPlayer.x = worldPos.x; this.ix.draggingPlayer.y = worldPos.y; this.app.scheduleRender(); } 
        else if (this.ix.drawingLine) { this.app.scheduleRender(); }
    }

    onPointerUp(e) {
        this.pointers.delete(e.pointerId);
        
        if (this.pointers.size === 0) { 
            this.ix.panStart = null;
            this.canvas.parentElement.classList.remove('panning');
            document.removeEventListener('pointerup', this._boundUp); 
            this.detachGlobalMove(); 
        }

        if (this.ix.draggingPlayer) {
            const p = this.ix.draggingPlayer; const rect = this.canvas.getBoundingClientRect();
            const screenX = e.clientX - rect.left; const screenY = e.clientY - rect.top;
            const distMoved = Math.hypot(screenX - this.ix.startScreenX, screenY - this.ix.startScreenY);
            
            if (p.type === 'ball') {
                const closest = this.state.f.players.find(ent => ent.type !== 'ball' && Math.hypot(ent.x - p.x, ent.y - p.y) < 35);
                if (closest) { p.x = closest.x; p.y = closest.y; }
            }

            if (distMoved <= 5) this.app.openRadial(p); else this.state.save();
            this.ix.draggingPlayer = null; this.app.scheduleRender();
        }
    }
}

class App {
    constructor() {
        this.canvas = document.getElementById('field');
        this.cfg = { scale: 2.8, radius: 14, animSpeed: 1500 };
        this.state = new StateStore(); this.vp = new Viewport(this.canvas, this);
        this.renderer = new Renderer(this.canvas.getContext('2d'), this.vp, this.cfg);
        this.input = new InputHandler(this.canvas, this.vp, this.state, this.renderer, this);
        this.pendingRedraw = false; this.animating = false; this.animReq = null;
        this.initUI(); this.prePopulate(); this.state.save();
    }

    prePopulate() {
        const cx = 400, cy = 720, s = 2.8;
        const add = (lbl, typ, x, y) => this.state.f.players.push({id: this.state.nextId++, label: lbl, type: typ, x, y});
        const b1 = {x: cx + (60*s*Math.cos(Math.PI/4)), y: cy - (60*s*Math.sin(Math.PI/4))};
        const b2 = {x: cx, y: cy - (60*s*Math.sqrt(2))};
        const b3 = {x: cx - (60*s*Math.cos(Math.PI/4)), y: cy - (60*s*Math.sin(Math.PI/4))};

        add('1', 'def', cx, cy - (46*s)); add('2', 'def', cx, cy + 35); add('3', 'def', b1.x + 10, b1.y - 45);
        add('4', 'def', b2.x + 40, b2.y + 15); add('5', 'def', b3.x - 10, b3.y - 45); add('6', 'def', b2.x - 40, b2.y + 15);
        add('7', 'def', b3.x - 40, b3.y - 140); add('8', 'def', b2.x, b2.y - 170); add('9', 'def', b1.x + 40, b1.y - 140);
        add('B1', 'off', cx - 22, cy); add('⚾', 'ball', cx, cy - (46*s));
    }

    initUI() {
        const def = document.getElementById('pal-def'); const off = document.getElementById('pal-off');
        for(let i=1; i<=9; i++) def.innerHTML += `<div class="token def" data-type="def">${i}</div>`;
        ['B1','B2','B3','B4'].forEach(l => off.innerHTML += `<div class="token off" data-type="off">${l}</div>`);
        
        document.querySelectorAll('.token').forEach(t => {
            t.addEventListener('pointerdown', e => {
                e.preventDefault();
                const centerScreenX = this.canvas.width / 2 / this.vp.dpr;
                const centerScreenY = this.canvas.height / 2 / this.vp.dpr;
                const wPos = this.vp.screenToWorld(centerScreenX, centerScreenY);
                this.state.f.players.push({
                    id: this.state.nextId++, label: e.target.innerText, type: e.target.dataset.type || 'ball',
                    x: wPos.x + (Math.random() * 30 - 15), y: wPos.y + (Math.random() * 30 - 15)
                });
                this.state.save(); this.scheduleRender(); this.toast(`${e.target.innerText} Added`);
            });
        });

        // Event Listeners for standard buttons
        document.getElementById('btn-undo').onclick = () => { if(this.state.undo()) this.renderer.clearCache(), this.syncUI(), this.scheduleRender(); };
        document.getElementById('btn-reset').onclick = () => {
            if(confirm('Clear ALL frames and reset to the initial state?')) {
                this.state.reset(); this.prePopulate(); this.state.save(); this.renderer.clearCache();
                this.vp.centerOn(400, 500); this.syncUI(); this.scheduleRender();
            }
        };

        // Event Listeners for Save/Load functionality
        document.getElementById('btn-save').onclick = () => this.exportPlaybook();
        document.getElementById('btn-load').onclick = () => document.getElementById('file-load').click();
        document.getElementById('file-load').onchange = (e) => this.importPlaybook(e);

        document.getElementById('btn-add-frame').onclick = () => {
            if(this.animating) return;
            const nF = structuredClone(this.state.f); nF.id = Date.now(); nF.name = `Frame ${this.state.frames.length + 1}`; nF.lines = [];
            nF.players.forEach(p => { const l = this.state.f.lines.find(li => li.startId === p.id); if(l) { p.x = l.end.x; p.y = l.end.y; }});
            this.state.frames.push(nF); this.state.currentIdx = this.state.frames.length - 1;
            this.state.save(); this.renderer.clearCache(); this.syncUI(); this.scheduleRender();
            const list = document.getElementById('frame-list'); setTimeout(() => list.scrollTo({ left: list.scrollWidth, behavior: 'smooth' }), 50);
        };

        document.getElementById('btn-del-frame').onclick = () => {
            if(this.state.frames.length <= 1 || this.animating) return;
            this.state.frames.splice(this.state.currentIdx, 1); this.state.currentIdx = Math.max(0, this.state.currentIdx - 1);
            this.state.save(); this.renderer.clearCache(); this.syncUI(); this.scheduleRender();
        }

        document.getElementById('btn-play').onclick = () => this.toggleAnim();
        document.getElementById('btn-export').onclick = () => this.exportVideo();
        
        document.getElementById('btn-zoom-in').onclick = () => { const r = this.canvas.getBoundingClientRect(); this.input.zoomAt(r.left + r.width/2, r.top + r.height/2, 1.2); };
        document.getElementById('btn-zoom-out').onclick = () => { const r = this.canvas.getBoundingClientRect(); this.input.zoomAt(r.left + r.width/2, r.top + r.height/2, 0.8); };
        document.getElementById('btn-zoom-reset').onclick = () => { this.vp.scale = 1; this.vp.centerOn(400, 500); this.scheduleRender(); };

        document.querySelectorAll('.radial-btn').forEach(b => b.addEventListener('pointerdown', e => {
            e.stopPropagation(); this.executeAction(e.target.closest('.radial-btn').dataset.action);
        }));
        this.syncUI();
    }

    toast(msg) {
        const t = document.getElementById('toast'); if(!t) return;
        t.innerText = msg; t.classList.add('show');
        clearTimeout(this._tTimer); this._tTimer = setTimeout(() => t.classList.remove('show'), 2000);
    }

    syncUI() {
        document.getElementById('btn-undo').disabled = this.state.historyIdx <= 0;
        const list = document.getElementById('frame-list'); list.innerHTML = '';
        this.state.frames.forEach((frm, i) => {
            const d = document.createElement('div'); d.className = `frame-item ${i === this.state.currentIdx ? 'active' : ''}`;
            const span = document.createElement('span'); span.className = 'frame-name';
            span.contentEditable = true; span.spellcheck = false; span.innerText = frm.name;
            span.onclick = (e) => { e.stopPropagation(); this.state.currentIdx = i; this.renderer.clearCache(); this.syncUI(); this.scheduleRender(); };
            span.onkeydown = (e) => { if(e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
            span.onblur = (e) => { let safeName = e.target.innerText.replace(/\n/g, '').slice(0, 30); e.target.innerText = safeName; this.state.frames[i].name = safeName; this.state.save(); };
            d.appendChild(span); list.appendChild(d);
        });
    }

    openRadial(player) {
        this.input.ix.activeEntity = player; const domPos = this.vp.worldToScreen(player.x, player.y);
        const menu = document.getElementById('radial-menu');
        menu.style.left = `${domPos.x - 70}px`; menu.style.top = `${domPos.y - 70}px`;
        menu.classList.add('active');
    }

    closeRadial() { document.getElementById('radial-menu').classList.remove('active'); this.input.ix.activeEntity = null; }

    executeAction(action) {
        const p = this.input.ix.activeEntity; this.closeRadial(); if(!p) return;
        if(action === 'delete') { 
            this.state.f.players = this.state.f.players.filter(ent => ent.id !== p.id); 
            this.state.f.lines = this.state.f.lines.filter(l => l.startId !== p.id); 
            this.renderer.clearCache(); 
            this.state.save(); this.scheduleRender(); return; 
        }
        if (action === 'throw' || action === 'hit') {
            const ball = this.state.f.players.find(ent => ent.type === 'ball');
            if (!ball) { this.toast('The ball is not on the field.'); return; }
            const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
            if (p.type === 'ball' || dist <= 35) {
                this.input.ix.drawingLine = { id: this.state.nextId++, startId: ball.id, type: action, start: {x: ball.x, y: ball.y}, end: {x: ball.x, y: ball.y} };
                this.input.attachGlobalMove();
            } else { this.toast(`Player must be near the ball to ${action}`); }
            return;
        }
        if (action === 'run' && p.type === 'ball') { this.toast('The ball cannot run routes.'); return; }
        this.input.ix.drawingLine = { id: this.state.nextId++, startId: p.id, type: action, start: {x: p.x, y: p.y}, end: {x: p.x, y: p.y} };
        this.input.attachGlobalMove(); 
    }

    _setPlaybackState(isActive) {
        this.animating = isActive;
        if(isActive) document.body.classList.add('is-animating');
        else document.body.classList.remove('is-animating');
    }

    toggleAnim() {
        if(this.animating) {
            cancelAnimationFrame(this.animReq); this._setPlaybackState(false);
            const btn = document.getElementById('btn-play'); btn.innerHTML = '▶ Play'; btn.classList.replace('btn-danger', 'btn-primary');
            this.scheduleRender(); return;
        }
        if(this.state.frames.length < 2) return;
        this._setPlaybackState(true); 
        const btn = document.getElementById('btn-play'); btn.innerHTML = '⏹ Stop'; btn.classList.replace('btn-primary', 'btn-danger');

        let cIdx = 0, sTime = null;
        const step = (ts) => {
            if(!sTime) sTime = ts; const p = Math.min((ts - sTime) / this.cfg.animSpeed, 1);
            this.renderer.draw(this.state, this.input.ix, p, this.state.frames[cIdx]);
            if(p < 1) { this.animReq = requestAnimationFrame(step); } 
            else {
                cIdx++; sTime = null;
                if(cIdx < this.state.frames.length) { this.animReq = requestAnimationFrame(step); } 
                else {
                    this._setPlaybackState(false); btn.innerHTML = '▶ Play'; btn.classList.replace('btn-danger', 'btn-primary');
                    this.state.currentIdx = this.state.frames.length - 1; this.syncUI();
                    this.renderer.draw(this.state, this.input.ix, 1.0, this.state.frames[this.state.currentIdx]);
                }
            }
        };
        this.animReq = requestAnimationFrame(step);
    }

    async exportVideo() {
        if(this.state.frames.length < 2 || this.animating) { this.toast('Need at least 2 frames to export.'); return; }
        
        this._setPlaybackState(true);
        const btn = document.getElementById('btn-export');
        const origText = btn.innerHTML;
        btn.innerHTML = '⏺ Rec...'; btn.classList.add('btn-danger');

        const stream = this.canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'playmaker-export.webm';
            a.click(); URL.revokeObjectURL(url);
            btn.innerHTML = origText; btn.classList.remove('btn-danger');
            this.toast('Video Exported!');
        };
        
        recorder.start();

        let cIdx = 0, sTime = null;
        const step = (ts) => {
            if(!sTime) sTime = ts; 
            const p = Math.min((ts - sTime) / this.cfg.animSpeed, 1);
            this.renderer.draw(this.state, this.input.ix, p, this.state.frames[cIdx]);

            if(p < 1) { 
                this.animReq = requestAnimationFrame(step); 
            } else {
                cIdx++; sTime = null;
                if(cIdx < this.state.frames.length) { 
                    this.animReq = requestAnimationFrame(step); 
                } else {
                    this._setPlaybackState(false);
                    recorder.stop();
                    this.state.currentIdx = this.state.frames.length - 1; 
                    this.syncUI();
                    this.renderer.draw(this.state, this.input.ix, 1.0, this.state.frames[this.state.currentIdx]);
                }
            }
        };
        this.animReq = requestAnimationFrame(step);
    }

    // --- NEW: Save and Load Logic ---
    exportPlaybook() {
        const data = JSON.stringify(this.state.frames, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `playbook-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.toast('Playbook Saved!');
    }

    importPlaybook(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsedData = JSON.parse(event.target.result);
                if (Array.isArray(parsedData) && parsedData.length > 0 && parsedData[0].players) {
                    this.state.frames = parsedData;
                    this.state.currentIdx = 0;
                    this.state.history = []; // Reset undo stack
                    this.state.historyIdx = -1;
                    
                    // Reset next ID counter to avoid conflicts
                    let maxId = 100;
                    this.state.frames.forEach(f => {
                        f.players.forEach(p => maxId = Math.max(maxId, p.id));
                        f.lines.forEach(l => maxId = Math.max(maxId, l.id));
                    });
                    this.state.nextId = maxId + 1;

                    this.state.save();
                    this.renderer.clearCache();
                    this.vp.centerOn(400, 500);
                    this.syncUI();
                    this.scheduleRender();
                    this.toast('Playbook Loaded successfully!');
                } else {
                    this.toast('Invalid playbook format.');
                }
            } catch (err) {
                this.toast('Error reading file.');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset the input so the same file can be loaded again if needed
    }

    scheduleRender() {
        if(!this.pendingRedraw) { this.pendingRedraw = true; requestAnimationFrame(() => { this.renderer.draw(this.state, this.input.ix); this.pendingRedraw = false; }); }
    }
}

document.addEventListener('DOMContentLoaded', () => window.PlaymakerApp = new App());