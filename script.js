const API_URL = "https://script.google.com/macros/s/AKfycbw5FgjU_NeBebC82cyMXb8-sYiyql5P9iw5ujdbQTnu7w0hMNCqTFwxPocIPh2bQVg/exec";

// Dados globais
let appointments = {};

// Cache
const DASH_CACHE = {};

// Data atual
const todayDate = new Date();
const yInit = todayDate.getFullYear();
const mInit = String(todayDate.getMonth() + 1).padStart(2, '0');
const dInit = String(todayDate.getDate()).padStart(2, '0');
let selectedDateKey = `${yInit}-${mInit}-${dInit}`;

let currentView = 'booking';
let currentSlotId = null;
let currentDateKey = null;

// Instâncias externas
let fpInstance = null;
let chartLocInstance = null;
let chartSpecInstance = null;

// Estados de movimento
let isMoveMode = false;
let clipboardPatient = null;

// Sessão
let currentUserToken = null;
let currentUserRole = null;
let currentUserName = null;
let pendingAction = null;

// Contratos
const CONTRACTS = {
    LOCALS: ["ESTADO", "SERRA", "SALGUEIRO"],
    MUNICIPAL: ["RECIFE", "JABOATÃO"]
};

// Procedimentos por especialidade
let SPECIALTY_PROCEDURES = {
    "CIRURGIA": [],
    "LASER": []
};

// Helper JSONP (CORS)
function jsonp(url) {
    return new Promise((resolve, reject) => {
        const callbackName = "cb_" + Math.round(Math.random() * 1000000);

        window[callbackName] = data => {
            resolve(data);
            delete window[callbackName];
            const script = document.getElementById(callbackName);
            if (script) script.remove();
        };

        const script = document.createElement("script");
        script.id = callbackName;
        const connector = url.includes('?') ? '&' : '?';
        script.src = `${url}${connector}callback=${callbackName}`;

        script.onerror = () => {
            delete window[callbackName];
            script.remove();
            reject(new Error("Erro de conexão JSONP (CORS/GAS)"));
        };

        document.body.appendChild(script);
    });
}

// Requisições GET centralizadas
async function apiGet(params = {}) {
    if (params.type !== 'verify' && params.type !== 'procedures' && !currentUserToken) {
        showToast("Sessão expirada. Faça login novamente.", "error");
        requestToken(null, "Sessão expirada");
        throw new Error("Token ausente no frontend");
    }

    const query = new URLSearchParams({
        ...params,
        token: params.token || currentUserToken || ""
    });

    return jsonp(`${API_URL}?${query.toString()}`);
}

// Guard de autenticação
function requireAuth() {
    if (!currentUserToken) {
        requestToken(null, "Sessão expirada");
        throw new Error("Token ausente");
    }
}

// Busca procedimentos
async function fetchProcedures() {
    try {
        const data = await apiGet({ type: 'procedures' });
        if (data) SPECIALTY_PROCEDURES = data;
    } catch (error) { console.error("Falha ao carregar procedimentos:", error); }
}

// Indicador de carregamento
function setLoading(isLoading, isBlocking = false) {
    const body = document.body;
    if (isLoading && isBlocking) {
        body.style.cursor = 'wait';
    } else {
        body.style.cursor = 'default';
    }
}

// Toast de notificação
function showToast(message, type = 'success') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #1e293b; color: white; padding: 12px 24px; border-radius: 50px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-weight: 600; font-size: 0.9rem;
            z-index: 5000; opacity: 0; transition: opacity 0.3s, top 0.3s; pointer-events: none;
            display: flex; align-items: center; gap: 8px;
        `;
        document.body.appendChild(toast);
    }
    const bg = type === 'success' ? '#059669' : (type === 'error' ? '#dc2626' : '#1e293b');
    toast.style.background = bg;

    const icon = type === 'success'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        : '';

    toast.innerHTML = `${icon} ${message}`;
    toast.style.top = '20px';
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.top = '0px';
    }, 3000);
}

// Formatação data BR
function formatDateBR(dateString) {
    if (!dateString) return '';
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Animação de métricas
function animateMetric(elementId, targetValue, isPercentage = false) {
    const element = document.getElementById(elementId);
    if (!element) return;

    let startValue = 0;
    const currentText = element.innerText;

    if (currentText !== '--' && currentText !== '--%') {
        startValue = parseFloat(currentText.replace('%', '').replace('(', '').replace(')', ''));
        if (isNaN(startValue)) startValue = 0;
    }

    if (Math.abs(startValue - targetValue) < 0.1) {
        element.innerText = isPercentage ? targetValue.toFixed(1) + '%' : Math.floor(targetValue);
        return;
    }

    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4);

        const current = startValue + (targetValue - startValue) * ease;

        if (isPercentage) {
            element.innerText = current.toFixed(1) + '%';
        } else {
            element.innerText = Math.floor(current);
        }

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.innerText = isPercentage ? targetValue.toFixed(1) + '%' : Math.floor(targetValue);
        }
    }

    requestAnimationFrame(update);
}

// Animação sub-métricas
function animateSubMetric(elementId, val, groupTotal) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const pct = groupTotal > 0 ? (val / groupTotal) * 100 : 0;
    const finalText = `${pct.toFixed(1)}% (${val})`;

    element.innerText = finalText;
}

// Extração de procedimentos do slot
function getProceduresFromSlot(slot) {
    if (!slot.procedure) return [];

    try {
        const parsed = JSON.parse(slot.procedure);
        if (Array.isArray(parsed)) return parsed;
        return [{ name: slot.procedure, regulated: (slot.regulated === true || slot.regulated === "TRUE" || slot.regulated === "YES") }];
    } catch (e) {
        return [{ name: slot.procedure, regulated: (slot.regulated === true || slot.regulated === "TRUE" || slot.regulated === "YES") }];
    }
}

// Controle de contrato
function handleContractChange() {
    const contract = document.getElementById('bk-contract').value;
    const isMunicipal = CONTRACTS.MUNICIPAL.includes(contract);
    const cb = document.getElementById('bk-proc-regulated');
    const label = cb.parentElement;

    if (isMunicipal) {
        cb.checked = false;
        cb.disabled = true;
        label.style.opacity = '0.5';
        label.style.cursor = 'not-allowed';
        label.title = "Não aplicável para contratos municipais";
    } else {
        cb.disabled = false;
        label.style.opacity = '1';
        label.style.cursor = 'pointer';
        label.title = "Marcar se é Regulado";
    }

    toggleRegulated();
}

// Toggle regulado/interno
function toggleRegulated() {
    checkWarning();
    const isReg = document.getElementById('bk-proc-regulated').checked;
    const contract = document.getElementById('bk-contract').value;
    const container = document.getElementById('bk-internal-type-container');

    if (!isReg && !CONTRACTS.MUNICIPAL.includes(contract)) {
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
        document.querySelectorAll('input[name="bk-internal-type"]').forEach(r => r.checked = false);
    }
}

// Cálculo cache mensal
function recalculateMonthCache(monthKey) {
    if (!monthKey) return;

    let totalSlots = 0;
    let occupiedSlots = 0;

    let counts = {
        Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        InternoTypes: {
            ESTADO: { Emergencia: 0, Projetos: 0 },
            SERRA: { Emergencia: 0, Projetos: 0 },
            SALGUEIRO: { Emergencia: 0, Projetos: 0 }
        },
        Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
    };

    Object.keys(appointments).forEach(dateKey => {
        if (dateKey.startsWith(monthKey)) {
            const daySlots = appointments[dateKey];
            totalSlots += daySlots.length;

            daySlots.forEach(s => {
                if (s.status === 'OCUPADO') {
                    occupiedSlots++;

                    const c = s.contract ? s.contract.toUpperCase() : null;
                    if (!c) return;

                    const procs = getProceduresFromSlot(s);

                    if (CONTRACTS.MUNICIPAL.includes(c)) {
                        const countToAdd = procs.length > 0 ? procs.length : 1;
                        counts.Municipal.Total += countToAdd;
                        if (counts.Municipal[c] !== undefined) counts.Municipal[c] += countToAdd;

                    } else if (CONTRACTS.LOCALS.includes(c)) {
                        if (procs.length > 0) {
                            procs.forEach(p => {
                                if (p.regulated) {
                                    counts.Regulado.Total++;
                                    if (counts.Regulado[c] !== undefined) counts.Regulado[c]++;
                                } else {
                                    counts.Interno.Total++;
                                    if (counts.Interno[c] !== undefined) counts.Interno[c]++;

                                    if (p.type === 'Emergência') counts.InternoTypes[c].Emergencia++;
                                    else if (p.type === 'Projetos') counts.InternoTypes[c].Projetos++;
                                    else counts.InternoTypes[c].Emergencia++;
                                }
                            });
                        } else {
                            let isReg = (s.regulated === true || s.regulated === "TRUE" || s.regulated === "YES");
                            if (isReg) {
                                counts.Regulado.Total++;
                                if (counts.Regulado[c] !== undefined) counts.Regulado[c]++;
                            } else {
                                counts.Interno.Total++;
                                if (counts.Interno[c] !== undefined) counts.Interno[c]++;
                                counts.InternoTypes[c].Emergencia++;
                            }
                        }
                    }
                }
            });
        }
    });

    if (!DASH_CACHE[monthKey]) DASH_CACHE[monthKey] = {};

    DASH_CACHE[monthKey].total = totalSlots;
    DASH_CACHE[monthKey].occupied = occupiedSlots;
    DASH_CACHE[monthKey].counts = counts;

    updateCalendarMarkers();
}

// Processamento de dados brutos
function processRawData(rows, forceDateKey = null) {
    if ((!rows || rows.length === 0) && forceDateKey) {
        if (!appointments[forceDateKey]) appointments[forceDateKey] = [];
        return;
    }

    rows.forEach(row => {
        const key = row.date;
        if (!key) return;

        if (!appointments[key]) appointments[key] = [];

        const exists = appointments[key].find(s => String(s.id) === String(row.id));

        if (!exists) {
            appointments[key].push({
                id: row.id,
                date: row.date,
                time: row.time,
                room: row.room,
                location: row.location,
                doctor: row.doctor,
                specialty: row.specialty,
                status: row.status,
                patient: row.patient,
                record: row.record,
                contract: row.contract,
                regulated: (row.regulated === true || row.regulated === "TRUE" || row.regulated === "YES"),
                procedure: row.procedure,
                detail: row.detail,
                eye: row.eye,
                createdBy: row.createdBy || row.created_by,
                updatedBy: row.updatedBy || (row.status === 'OCUPADO' ? (row.createdBy || row.created_by) : "")
            });
        } else {
            const idx = appointments[key].findIndex(s => String(s.id) === String(row.id));
            if (idx !== -1) {
                appointments[key][idx] = {
                    ...appointments[key][idx],
                    status: row.status,
                    patient: row.patient,
                    record: row.record,
                    contract: row.contract,
                    regulated: (row.regulated === true || row.regulated === "TRUE" || row.regulated === "YES"),
                    procedure: row.procedure,
                    detail: row.detail,
                    eye: row.eye,
                    createdBy: row.createdBy || row.created_by,
                    updatedBy: row.updatedBy || (row.status === 'OCUPADO' ? (row.createdBy || row.created_by) : "")
                };
            }
        }
    });

    if (forceDateKey) {
        recalculateMonthCache(forceDateKey.substring(0, 7));
    } else if (rows.length > 0) {
        recalculateMonthCache(rows[0].date.substring(0, 7));
    }
}

// Busca dados por dia
async function fetchRemoteData(dateKey, isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
        const data = await apiGet({ date: dateKey });
        if (data.length === 0) appointments[dateKey] = [];
        processRawData(data, dateKey);

        if (dateKey === selectedDateKey) {
            renderSlotsList();
            if (currentView === 'admin') renderAdminTable();
        }
        updateKPIs();
    } catch (error) {
        if (!isBackground) showToast('Erro de conexão ou token inválido.', 'error');
    } finally {
        if (!isBackground) setLoading(false);
    }
}

// Sincroniza mês
async function syncMonthData(baseDateKey) {
    if (!baseDateKey) return;
    const parts = baseDateKey.split('-');
    const monthKey = `${parts[0]}-${parts[1]}`;

    if (DASH_CACHE[monthKey] && DASH_CACHE[monthKey].loaded) return;

    setLoading(true);
    try {
        const preUpdateHash = JSON.stringify(appointments[selectedDateKey] || []);
        const data = await apiGet({ month: monthKey });

        Object.keys(appointments).forEach(k => { if (k.startsWith(monthKey)) delete appointments[k]; });
        processRawData(data);

        if (!DASH_CACHE[monthKey]) recalculateMonthCache(monthKey);
        DASH_CACHE[monthKey].loaded = true;

        if (selectedDateKey.startsWith(monthKey)) {
            const postUpdateHash = JSON.stringify(appointments[selectedDateKey] || []);
            if (preUpdateHash !== postUpdateHash) renderSlotsList();
            if (currentView === 'admin') renderAdminTable();
            updateKPIs();
        }
    } catch (e) {
        showToast("Erro ao sincronizar mês.", "error");
    } finally {
        setLoading(false);
    }
}

// Envio para Sheets
async function sendUpdateToSheet(payload) {
    try {
        requireAuth();
        payload.token = currentUserToken;

        const params = new URLSearchParams();
        for (const key in payload) {
            if (typeof payload[key] === "object") {
                params.append(key, JSON.stringify(payload[key]));
            } else {
                params.append(key, payload[key]);
            }
        }

        const response = await jsonp(`${API_URL}?${params.toString()}`);
        return response;
    } catch (error) {
        console.error("Erro no envio:", error);
        return { status: "error", message: error.message };
    }
}

// Login
async function attemptLogin() {
    const input = document.getElementById('login-token');
    const val = input.value.trim();
    const err = document.getElementById('login-error');
    const btn = document.querySelector('#login-modal .btn-primary');

    if (!val) return;

    btn.innerText = "Verificando...";
    btn.disabled = true;

    try {
        const data = await apiGet({ type: 'verify', token: val });

        if (data.valid) {
            currentUserToken = val;
            currentUserRole = data.user.role;
            currentUserName = data.user.name;

            closeLoginModal();

            if (pendingAction) {
                pendingAction();
                pendingAction = null;
            } else {
                initDataFlow();
            }
        } else {
            throw new Error("Token inválido");
        }
    } catch (error) {
        err.style.display = 'block';
        input.style.borderColor = '#dc2626';
    } finally {
        btn.innerText = "Acessar Sistema";
        btn.disabled = false;
    }
}

function handleLoginKey(e) { if (e.key === 'Enter') attemptLogin(); }

// Solicitação de token
function requestToken(callback, customTitle = null) {
    if (currentUserToken) {
        if (callback) callback();
        return;
    }

    pendingAction = callback;
    const modal = document.getElementById('login-modal');
    const input = document.getElementById('login-token');
    modal.querySelector('h2').innerText = customTitle || "Acesso Restrito";
    input.value = '';
    document.getElementById('login-error').style.display = 'none';
    input.style.borderColor = '';
    modal.style.display = 'flex';
    input.focus();
}

function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('login-token').value = '';
}

// Troca de visão
function switchView(view) {
    if (view === 'admin') {
        requestToken(() => executeSwitch('admin'), "Acesso Gestor");
    } else {
        executeSwitch('booking');
    }
}

function executeSwitch(view) {
    if (view === 'admin' && currentUserRole !== 'GESTOR') {
        return showToast('Permissão insuficiente.', 'error');
    }

    currentView = view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-view-${view}`).classList.add('active');

    document.getElementById('view-booking').style.display = 'none';
    document.getElementById('view-admin').style.display = 'none';
    document.getElementById('section-stats').style.display = 'none';

    const sidebar = document.querySelector('.listing-column');

    if (view === 'booking') {
        document.getElementById('view-booking').style.display = 'block';
        document.getElementById('section-stats').style.display = 'block';
        sidebar.classList.remove('locked');
        updateKPIs();
    } else {
        document.getElementById('view-admin').style.display = 'block';
        renderAdminTable();
        sidebar.classList.add('locked');
    }
}

// Inicialização
async function initData() {
    const splash = document.getElementById('app-splash-screen');

    if (!currentUserToken) {
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => { splash.style.display = 'none'; }, 500);
        }

        requestToken(() => {
            if (splash) {
                splash.style.display = 'flex';
                splash.style.opacity = '1';
            }
            initDataFlow();
        }, "Bem-vindo ao GovCirúrgica");
        return;
    }
    initDataFlow();
}

async function initDataFlow() {
    await fetchProcedures();

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const formatYMD = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const dashStart = document.getElementById('dash-date-start');
    const dashEnd = document.getElementById('dash-date-end');
    if (dashStart) dashStart.value = formatYMD(firstDay);
    if (dashEnd) dashEnd.value = formatYMD(lastDay);

    fpInstance = flatpickr("#sidebar-date-picker", {
        locale: "pt", dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y",
        defaultDate: selectedDateKey, disableMobile: "true",
        onChange: function (selectedDates, dateStr, instance) {
            if (dateStr && dateStr !== selectedDateKey) {
                selectedDateKey = dateStr;
                updateSidebarDate();
            }
        },
        onMonthChange: function (selectedDates, dateStr, instance) {
            const year = instance.currentYear;
            const month = String(instance.currentMonth + 1).padStart(2, '0');
            syncMonthData(`${year}-${month}`);
        }
    });

    const dashPicker = document.getElementById('dashboard-month-picker');
    if (dashPicker) {
        dashPicker.value = selectedDateKey.substring(0, 7);
        dashPicker.addEventListener('change', (e) => { syncMonthData(e.target.value); });
    }

    await syncMonthData(selectedDateKey);

    const triggerBox = document.getElementById('date-trigger-box');
    if (triggerBox && fpInstance) {
        triggerBox.addEventListener('click', () => { fpInstance.open(); });
    }

    const splash = document.getElementById('app-splash-screen');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => { splash.style.display = 'none'; }, 500);
    }

    updateFilterOptions();
    renderSlotsList();
    updateKPIs();
    updateCalendarMarkers();
}

// Marcadores do calendário
function updateCalendarMarkers() {
    if (!fpInstance) return;

    const freeDates = [];
    Object.keys(appointments).forEach(key => {
        const slots = appointments[key];
        const hasFree = slots.some(s => s.status === 'LIVRE');
        if (hasFree) freeDates.push(key);
    });

    const days = document.querySelectorAll('.flatpickr-day');
    days.forEach(day => day.classList.remove('has-free-slots'));

    fpInstance.set('onDayCreate', function (dObj, dStr, fp, dayElem) {
        const date = dayElem.dateObj;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;

        if (freeDates.includes(key)) {
            dayElem.classList.add('has-free-slots');
        }
    });

    fpInstance.redraw();
}

function updateSidebarDate() {
    if (fpInstance && fpInstance.input.value !== selectedDateKey) {
        fpInstance.setDate(selectedDateKey, false);
    }

    document.getElementById('room-filter').value = 'ALL';
    document.getElementById('location-filter').value = 'ALL';

    const monthKey = selectedDateKey.substring(0, 7);

    if (DASH_CACHE[monthKey] && DASH_CACHE[monthKey].loaded) {
        updateFilterOptions();
        renderSlotsList();
    } else {
        setLoading(true, false);
        syncMonthData(selectedDateKey).then(() => {
            updateFilterOptions();
            renderSlotsList();
            setLoading(false);
        });
    }
}

// Atualização manual
async function refreshData() {
    const btn = document.getElementById('btn-manual-refresh');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'wait';
        const icon = btn.querySelector('svg');
        if (icon) icon.style.animation = 'spin 1s linear infinite';
    }

    try {
        const monthKey = selectedDateKey.substring(0, 7);
        if (DASH_CACHE[monthKey]) DASH_CACHE[monthKey].loaded = false;

        setLoading(true, false);
        await syncMonthData(selectedDateKey);

        updateFilterOptions();
        renderSlotsList();
        updateKPIs();
        updateCalendarMarkers();

        showToast("Agenda atualizada.", "success");
    } catch (error) {
        console.error("Erro ao atualizar:", error);
        showToast("Falha na atualização.", "error");
    } finally {
        setLoading(false);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            const icon = btn.querySelector('svg');
            if (icon) icon.style.animation = 'none';
        }
    }
}

// Verificação de disponibilidade
async function verifySlotAvailability(slotId, isBackground = false) {
    const monthKey = selectedDateKey.substring(0, 7);
    if (DASH_CACHE[monthKey]) DASH_CACHE[monthKey].loaded = false;

    setLoading(true, !isBackground);
    await syncMonthData(selectedDateKey);
    setLoading(false);

    let foundSlot = null;
    if (appointments[selectedDateKey]) {
        foundSlot = appointments[selectedDateKey].find(s => String(s.id) === String(slotId));
    }
    return foundSlot;
}

function changeDate(delta) {
    const current = new Date(selectedDateKey + 'T00:00:00');
    current.setDate(current.getDate() + delta);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    const newKey = `${y}-${m}-${d}`;

    if (fpInstance) fpInstance.setDate(newKey, true);
}

// UI Vagas
function handleSlotClick(slot, key) {
    currentSlotId = slot.id;
    currentDateKey = key;
    renderSlotsList();

    if (currentView === 'booking') {
        if (slot.status === 'LIVRE') {
            handleVerifyAndOpen(slot);
        } else {
            openBookingModal(slot, key);
        }
    }
}

async function handleVerifyAndOpen(slot) {
    openBookingModal(slot, selectedDateKey);

    const modalTitle = document.getElementById('msg-title');
    const originalTitle = modalTitle ? modalTitle.innerText : 'Agendar';
    if (modalTitle) modalTitle.innerText = 'Agendar (Verificando...)';

    const FRESH_SLOT = await verifySlotAvailability(slot.id, true);

    if (modalTitle) modalTitle.innerText = originalTitle;

    if (!FRESH_SLOT) {
        closeModal();
        showToast("Vaga não encontrada ou excluída.", "error");
        renderSlotsList();
        return;
    }

    if (FRESH_SLOT.status !== 'LIVRE') {
        closeModal();
        showToast("Conflito: Vaga acabou de ser ocupada.", "error");
        renderSlotsList();
        return;
    }
}

function updateFilterOptions() {
    const slots = appointments[selectedDateKey] || [];

    const rooms = [...new Set(slots.map(s => s.room))].filter(r => r).sort();
    const locations = [...new Set(slots.map(s => s.location || 'Iputinga'))].filter(l => l).sort();
    const specialties = [...new Set(slots.map(s => s.specialty))].filter(s => s).sort();

    const roomSelect = document.getElementById('room-filter');
    const locSelect = document.getElementById('location-filter');
    const specSelect = document.getElementById('specialty-filter');

    const currentRoom = roomSelect.value;
    const currentLoc = locSelect.value;
    const currentSpec = specSelect ? specSelect.value : 'ALL';

    roomSelect.innerHTML = '<option value="ALL">Todas Salas</option>';
    rooms.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        roomSelect.appendChild(opt);
    });
    if (rooms.includes(currentRoom)) roomSelect.value = currentRoom;
    else roomSelect.value = 'ALL';

    locSelect.innerHTML = '<option value="ALL">Todas Unidades</option>';
    locations.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        locSelect.appendChild(opt);
    });
    if (locations.includes(currentLoc)) locSelect.value = currentLoc;
    else locSelect.value = 'ALL';

    if (specSelect) {
        specSelect.innerHTML = '<option value="ALL">Todas Especialidades</option>';
        specialties.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            specSelect.appendChild(opt);
        });
        if (specialties.includes(currentSpec)) specSelect.value = currentSpec;
        else specSelect.value = 'ALL';
    }
}

function applyFilters() { renderSlotsList(); }

function renderSlotsList() {
    const container = document.getElementById('slots-list-container');
    container.innerHTML = '';

    const currentDateSlots = appointments[selectedDateKey] || [];

    const locFilter = document.getElementById('location-filter').value;
    const roomFilter = document.getElementById('room-filter').value;
    const shiftFilter = document.getElementById('shift-filter').value;
    const specFilter = document.getElementById('specialty-filter') ? document.getElementById('specialty-filter').value : 'ALL';

    let slots = currentDateSlots.filter(s => {
        if (String(s.status).toUpperCase() === 'EXCLUIDO') return false;

        let pass = true;
        if (locFilter !== 'ALL' && s.location !== locFilter) pass = false;
        if (roomFilter !== 'ALL' && String(s.room) !== String(roomFilter)) pass = false;

        if (shiftFilter !== 'ALL') {
            const h = parseInt(s.time.split(':')[0]);
            if (shiftFilter === 'MANHA' && h >= 13) pass = false;
            if (shiftFilter === 'TARDE' && h < 13) pass = false;
        }

        if (specFilter !== 'ALL' && s.specialty !== specFilter) pass = false;

        return pass;
    });

    slots.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.status !== b.status) return a.status === 'LIVRE' ? -1 : 1;
        return a.time.localeCompare(b.time);
    });

    if (slots.length === 0) {
        container.innerHTML = `
        <div style="padding:40px; text-align:center; color:#94a3b8;">
            <div style="font-size:3rem; margin-bottom:16px; opacity:0.3">📭</div>
            <div>Nenhuma vaga encontrada para os filtros.</div>
        </div>`;
        return;
    }

    slots.forEach((slot, index) => {
        const item = document.createElement('div');
        item.className = 'slot-item';
        if (currentSlotId === slot.id) item.classList.add('active');

        let statusClass = slot.status === 'LIVRE' ? 'free' : 'booked';
        let statusText = slot.status === 'LIVRE' ? 'Disponível' : 'Ocupado';
        let doctorName = slot.doctor ? `<b>${slot.doctor.split(' ')[0]} ${slot.doctor.split(' ')[1] || ''}</b>` : 'Sem Médico';

        const parts = slot.date.split('-');
        const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;

        let mainInfo = `
        <div style="flex:1">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%">
                <div class="slot-time" style="display:flex; gap:8px; align-items:center;">
                    <span style="background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:600;">${formattedDate}</span>
                    <span>${slot.time}</span>
                </div>
                 <div class="slot-room-badge" style="white-space:nowrap;">Sala ${slot.room}</div>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">${slot.location || 'Iputinga'}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">${doctorName}</div>
            <div style="font-size:0.75rem; color:#64748b; font-weight:600; margin-top:2px; text-transform:uppercase;">${slot.specialty || '-'}</div>
        `;

        if (slot.status === 'OCUPADO') {
            const procs = getProceduresFromSlot(slot);
            let procDisplay = '-';
            if (procs.length === 1) {
                procDisplay = procs[0].name;
            } else if (procs.length > 1) {
                procDisplay = `${procs.length} Procedimentos`;
            } else {
                procDisplay = slot.specialty || '-';
            }

            mainInfo += `
            <div style="font-size:0.75rem; color:#0284c7; margin-top:2px; font-weight:600">${procDisplay}</div>
            <div class="slot-detail-box">
                <div class="detail-patient">${slot.patient}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">Pront: ${slot.record || '?'}</div>
                <div class="detail-meta"><span class="badge-kpi">${slot.contract}</span></div>
            </div>
            <div style="font-size:0.65rem; color:#94a3b8; text-align:right; margin-top:4px; font-style:italic">
                 ${slot.updatedBy ? 'Agendado por: ' + slot.updatedBy : ''} 
            </div>
            `;
        }

        mainInfo += `</div>`;

        item.innerHTML = `
        ${mainInfo}
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px">
             <div class="slot-status-badge ${statusClass}">${statusText}</div>
             ${slot.detail ? `<div style="font-size:0.7rem; color:var(--text-secondary); margin-top:4px">${slot.detail}</div>` : ''}
        </div>`;

        item.onclick = () => handleSlotClick(slot, slot.date);
        container.appendChild(item);
    });
}

// Geração em lote
function bulkCreateSlots() {
    const dateVal = document.getElementById('bulk-date').value;
    const location = document.getElementById('bulk-location').value;
    const room = document.getElementById('bulk-room').value.trim();
    const group = document.getElementById('bulk-group').value;
    const doctor = document.getElementById('bulk-doctor').value.trim();
    const startTime = document.getElementById('bulk-start-time').value;
    const endTime = document.getElementById('bulk-end-time').value;
    const qty = parseInt(document.getElementById('bulk-qty').value);

    if (!dateVal || !startTime || !endTime || !doctor || !room || isNaN(qty) || qty < 1) {
        return showToast('Preencha todos os campos, incluindo a Sala.', 'error');
    }

    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    const startMins = h1 * 60 + m1;
    const endMins = h2 * 60 + m2;

    if (endMins <= startMins) {
        return showToast('Horário final inválido.', 'error');
    }

    const slotDuration = (endMins - startMins) / qty;
    let slotsToSend = [];

    for (let i = 0; i < qty; i++) {
        const currentSlotMins = Math.round(startMins + (i * slotDuration));
        const h = Math.floor(currentSlotMins / 60);
        const m = currentSlotMins % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        slotsToSend.push({
            id: Date.now() + i,
            date: dateVal,
            time: timeStr,
            room: room,
            location: location,
            doctor: doctor,
            specialty: group,
            procedure: group
        });
    }

    const btn = document.querySelector('button[onclick="bulkCreateSlots()"]');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> Criando...`;
    btn.disabled = true;
    btn.style.opacity = '0.7';

    const payload = {
        action: "create_bulk",
        data: slotsToSend
    };

    sendUpdateToSheet(payload).then(resp => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        btn.style.opacity = '1';

        if (resp && resp.status === 'success') {
            showToast(`${qty} vagas criadas!`, 'success');

            document.getElementById('bulk-room').value = '';
            document.getElementById('bulk-doctor').value = '';
            document.getElementById('bulk-date').value = '';
            document.getElementById('bulk-qty').value = '1';
            document.getElementById('bulk-start-time').value = '07:00';
            document.getElementById('bulk-end-time').value = '12:00';

            processRawData(slotsToSend.map(s => ({ ...s, status: 'LIVRE' })));

            selectedDateKey = dateVal;
            document.getElementById('sidebar-date-picker').value = selectedDateKey;
            renderSlotsList();
            updateKPIs();
            executeSwitch('booking');
        } else {
            showToast('Erro ao processar criação.', 'error');
        }
    }).catch(err => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        btn.style.opacity = '1';
        showToast('Erro no servidor.', 'error');
    });
}

// Admin Table
function renderAdminTable() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    const currentlyChecked = Array.from(document.querySelectorAll('.slot-checkbox:checked'))
        .map(cb => String(cb.value));

    tbody.innerHTML = '';
    const targetMonth = selectedDateKey.substring(0, 7);
    const slots = [];

    Object.keys(appointments).forEach(k => {
        if (k.startsWith(targetMonth)) slots.push(...appointments[k]);
    });

    slots.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
    });

    slots.forEach(slot => {
        const tr = document.createElement('tr');
        let statusHtml = slot.status === 'OCUPADO'
            ? `<span style="background:#fee2e2; color:#dc2626; padding:2px 8px; border-radius:12px; font-weight:600; font-size:0.75rem">OCUPADO</span>`
            : `<span style="background:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:12px; font-weight:600; font-size:0.75rem">LIVRE</span>`;

        const dateFmt = `${slot.date.split('-')[2]}/${slot.date.split('-')[1]}`;
        const isChecked = currentlyChecked.includes(String(slot.id)) ? 'checked' : '';

        let specDisplay = slot.specialty;
        const procs = getProceduresFromSlot(slot);
        if (procs.length > 1) specDisplay = `${procs.length} Procs`;
        else if (procs.length === 1) specDisplay = procs[0].name;

        tr.innerHTML = `
            <td style="text-align:center">
                <input type="checkbox" class="slot-checkbox" value="${slot.id}" ${isChecked} onchange="updateDeleteButton()">
            </td>
            <td>${dateFmt}</td>
            <td>${slot.time}</td>
            <td>${slot.room}</td>
            <td>
                <div style="font-weight:600; font-size:0.85rem">${slot.doctor}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">${specDisplay}</div>
            </td>
            <td>${statusHtml}</td>
            <td style="text-align:center">
                <button class="btn btn-danger btn-delete-single" style="padding:4px 8px; font-size:0.75rem" onclick="deleteSlot('${slot.id}')">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDeleteButton();
    const masterCheck = document.getElementById('check-all-slots');
    if (masterCheck) {
        const total = document.querySelectorAll('.slot-checkbox').length;
        const checked = document.querySelectorAll('.slot-checkbox:checked').length;
        masterCheck.checked = (total > 0 && total === checked);
    }
}

function toggleAllSlots(source) {
    document.querySelectorAll('.slot-checkbox').forEach(cb => cb.checked = source.checked);
    updateDeleteButton();
}

function updateDeleteButton() {
    const total = document.querySelectorAll('.slot-checkbox:checked').length;
    const btn = document.getElementById('btn-delete-selected');
    const countSpan = document.getElementById('count-selected');
    const singleBtns = document.querySelectorAll('.btn-delete-single');

    singleBtns.forEach(b => {
        b.style.opacity = total > 0 ? '0.3' : '1';
        b.style.pointerEvents = total > 0 ? 'none' : 'auto';
    });

    if (btn) {
        if (total > 0) {
            btn.style.display = 'inline-flex';
            if (countSpan) countSpan.innerText = total;
        } else {
            btn.style.display = 'none';
        }
    }
}

async function deleteSelectedSlots() {
    const checkboxes = document.querySelectorAll('.slot-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    if (ids.length === 0) return;

    showMessageModal('Confirmação', `Deseja excluir ${ids.length} vagas selecionadas?`, 'confirm', () => {
        processBatchDelete(ids);
    });
}

async function processBatchDelete(ids) {
    showMessageModal('Processando', `Excluindo ${ids.length} vagas...`, 'loading');
    try {
        const payload = { action: "delete_bulk", ids: ids };
        const resp = await sendUpdateToSheet(payload);
        if (resp && resp.status === 'success') {
            Object.keys(appointments).forEach(key => {
                appointments[key] = appointments[key].filter(s => !ids.includes(String(s.id)));
            });
            recalculateMonthCache(selectedDateKey.substring(0, 7));
            closeMessageModal();
            renderSlotsList();
            renderAdminTable();
            updateKPIs();
            showToast(`${resp.count || ids.length} vagas excluídas.`, 'success');
        } else {
            closeMessageModal();
            showToast(`Erro ao excluir: ${resp ? resp.message : 'Erro'}`, 'error');
        }
    } catch (e) {
        closeMessageModal();
        showToast("Erro de conexão.", "error");
    }
}

function deleteSlot(id) {
    const monthKey = selectedDateKey.substring(0, 7);
    let slot = null;
    Object.keys(appointments).forEach(k => {
        if (!slot && k.startsWith(monthKey)) slot = appointments[k].find(s => String(s.id) === String(id));
    });
    let msg = 'Excluir vaga permanentemente?';
    if (slot && slot.status === 'OCUPADO') {
        msg = `<b>ATENÇÃO:</b> Vaga com paciente <b>${slot.patient}</b>. Excluir removerá ambos.`;
    }
    showMessageModal('Excluir', msg, 'confirm', async () => {
        closeMessageModal();
        setLoading(true, true);
        const resp = await sendUpdateToSheet({ action: "delete", id: id });
        if (resp && resp.status === 'success') {
            Object.keys(appointments).forEach(key => {
                appointments[key] = appointments[key].filter(s => String(s.id) !== String(id));
            });
            recalculateMonthCache(selectedDateKey.substring(0, 7));
            renderSlotsList();
            renderAdminTable();
            updateKPIs();
            showToast('Vaga excluída.', 'success');
        }
        setLoading(false);
    });
}

// Modal Agendamento
function openBookingModal(slot, dateKey) {
    document.getElementById('booking-modal').classList.add('open');
    document.getElementById('msg-title').innerText = 'Agendar';

    document.getElementById('modal-slot-info').innerHTML = `
        <div style="display:flex; gap:12px; font-size: 0.9rem; align-items:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            <span>DATA: <b>${formatDateBR(dateKey)}</b></span>
            <span style="color:#cbd5e1">|</span>
            <span>HORA: <b>${slot.time}</b></span>
            <span style="color:#cbd5e1">|</span>
            <span style="overflow:hidden; text-overflow:ellipsis;">SALA: <b>${slot.room}</b></span>
        </div>
    `;

    document.getElementById('selected-slot-id').value = slot.id;
    document.getElementById('bk-specialty').value = slot.specialty || '';
    const btnArea = document.getElementById('action-buttons-area');
    btnArea.innerHTML = '';

    if (slot.status === 'OCUPADO') {
        document.getElementById('bk-patient').value = slot.patient || '';
        document.getElementById('bk-record').value = slot.record || '';
        document.getElementById('bk-contract').value = slot.contract || '';
        try {
            if (slot.procedure) {
                const plist = JSON.parse(slot.procedure);
                if (Array.isArray(plist) && plist.length > 0) {
                    updateProcedureSelectOptions(slot.specialty, plist[0].name || '');
                    document.getElementById('bk-proc-regulated').checked = plist[0].regulated;
                    if (!plist[0].regulated && plist[0].type) {
                        document.querySelectorAll('input[name="bk-internal-type"]').forEach(r => {
                            if (r.value === plist[0].type) r.checked = true;
                        });
                    }
                }
            }
        } catch (e) {
            updateProcedureSelectOptions(slot.specialty, slot.procedure || '');
            document.getElementById('bk-proc-regulated').checked = slot.regulated || false;
        }
        toggleRegulated();

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-danger';
        cancelBtn.innerText = 'Liberar Vaga';
        cancelBtn.onclick = cancelSlotBooking;
        btnArea.appendChild(cancelBtn);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.innerText = 'Salvar Alterações';
        saveBtn.onclick = confirmBookingFromModal;
        btnArea.appendChild(saveBtn);
    } else {
        document.getElementById('bk-patient').value = '';
        document.getElementById('bk-record').value = '';
        document.getElementById('bk-contract').value = '';
        updateProcedureSelectOptions(slot.specialty, '');
        document.getElementById('bk-proc-regulated').checked = true;

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.innerText = 'Confirmar';
        confirmBtn.onclick = confirmBookingFromModal;
        btnArea.appendChild(confirmBtn);
        toggleRegulated();
    }
}

function updateProcedureSelectOptions(specialtyGroup, currentProcName = '') {
    const select = document.getElementById('bk-procedure');
    select.innerHTML = '<option value="">Selecione o procedimento...</option>';

    const rawSpecialty = (specialtyGroup || "").trim();
    const mapAccents = { 'Ç': 'C', 'Ã': 'A', 'Õ': 'O', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Â': 'A', 'Ê': 'E', 'À': 'A' };
    let normalizedSpec = rawSpecialty.toUpperCase().replace(/[ÇÃÕÁÉÍÓÚÂÊ]/g, c => mapAccents[c] || c);

    if (normalizedSpec === 'LASERS') normalizedSpec = 'LASER';
    if (normalizedSpec !== 'LASER') normalizedSpec = 'CIRURGIA';

    let procs = SPECIALTY_PROCEDURES[normalizedSpec] || [];
    procs = [...procs].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    procs.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === currentProcName) opt.selected = true;
        select.appendChild(opt);
    });

    if (currentProcName && !procs.includes(currentProcName)) {
        const opt = document.createElement('option');
        opt.value = currentProcName;
        opt.textContent = currentProcName + " (Legado/Personalizado)";
        opt.selected = true;
        select.appendChild(opt);
    }
}

function closeModal() { document.getElementById('booking-modal').classList.remove('open'); }

function checkWarning() {
    const warningBox = document.getElementById('warning-box');
    if (warningBox) warningBox.style.display = 'none';
}

function confirmBookingFromModal() {
    const id = document.getElementById('selected-slot-id').value;
    const record = document.getElementById('bk-record').value;
    const patient = document.getElementById('bk-patient').value;
    const contract = document.getElementById('bk-contract').value;
    const name = document.getElementById('bk-procedure').value.trim();
    const isReg = document.getElementById('bk-proc-regulated').checked;

    if (!patient || !contract || !record || !name) {
        return showToast('Preencha os campos obrigatórios.', 'error');
    }

    let internalType = null;
    if (!isReg && !CONTRACTS.MUNICIPAL.includes(contract)) {
        const selectedRadio = document.querySelector('input[name="bk-internal-type"]:checked');
        if (!selectedRadio) return showToast('Selecione Emergência ou Projetos.', 'error');
        internalType = selectedRadio.value;
    }

    const procedureJSON = JSON.stringify([{ name: name, regulated: isReg, type: internalType }]);
    const mainRegulatedStatus = isReg;

    const summary = `
        <div style="text-align:left; background:#f8fafc; padding:16px; border-radius:8px; font-size:0.9rem; border:1px solid #e2e8f0">
            <div><b>Paciente:</b> ${patient}</div>
            <div><b>Contrato:</b> ${contract}</div>
            <div style="margin-top:8px; font-weight:600; border-top:1px dashed #ccc; padding-top:4px">Procedimento:</div>
            <ul style="margin:0; padding-left:20px; font-size:0.85rem">
                <li>${name} (${isReg ? 'Regulado' : 'Interno'})</li>
            </ul>
        </div>
        <div style="margin-top:16px; font-weight:600">Confirmar?</div>
    `;

    showMessageModal('Confirmação', summary, 'confirm', () => {
        requestToken(async () => {
            Object.keys(appointments).forEach(dateKey => {
                const slotIndex = appointments[dateKey].findIndex(s => String(s.id) === String(id));
                if (slotIndex !== -1) {
                    appointments[dateKey][slotIndex] = {
                        ...appointments[dateKey][slotIndex],
                        status: 'OCUPADO',
                        patient: patient,
                        record: record,
                        contract: contract,
                        regulated: mainRegulatedStatus,
                        procedure: procedureJSON,
                        detail: "",
                        eye: "",
                        updatedBy: currentUserName
                    };
                }
            });

            recalculateMonthCache(selectedDateKey.substring(0, 7));
            closeMessageModal();
            closeModal();
            renderSlotsList();
            updateKPIs();
            showToast("Agendamento realizado!", "success");

            const payload = {
                action: "update",
                id: id,
                status: 'OCUPADO',
                patient: patient,
                record: record,
                contract: contract,
                regulated: mainRegulatedStatus,
                procedure: procedureJSON,
                detail: "",
                eye: ""
            };

            sendUpdateToSheet(payload).then(async (resp) => {
                if (!(resp && resp.status === 'success')) {
                    showToast("CONFLITO ou erro de servidor.", "error");
                    await refreshData();
                } else if (isMoveMode && clipboardPatient && clipboardPatient.originId) {
                    const originId = clipboardPatient.originId;
                    await sendUpdateToSheet({
                        action: "update",
                        id: originId,
                        status: 'LIVRE',
                        patient: '', record: '', contract: '', regulated: null,
                        procedure: '', detail: '', eye: ''
                    });

                    Object.keys(appointments).forEach(k => {
                        const idx = appointments[k].findIndex(s => String(s.id) === String(originId));
                        if (idx !== -1) appointments[k][idx].status = 'LIVRE';
                    });

                    showToast("Realocação concluída!", "success");
                    isMoveMode = false;
                    clipboardPatient = null;
                    document.querySelector('.listing-column').style.borderLeft = "none";
                    renderSlotsList();
                }
            });
        });
    });
}

function cancelSlotBooking() {
    showMessageModal('Liberar Vaga', 'Remover paciente?', 'confirm', () => {
        requestToken(async () => {
            const id = document.getElementById('selected-slot-id').value;

            Object.keys(appointments).forEach(dateKey => {
                const slotIndex = appointments[dateKey].findIndex(s => String(s.id) === String(id));
                if (slotIndex !== -1) {
                    appointments[dateKey][slotIndex] = {
                        ...appointments[dateKey][slotIndex],
                        status: 'LIVRE',
                        patient: '', record: '', contract: '', regulated: null,
                        procedure: '', detail: '', eye: '',
                        updatedBy: currentUserName
                    };
                }
            });

            recalculateMonthCache(selectedDateKey.substring(0, 7));
            closeMessageModal();
            closeModal();
            renderSlotsList();
            updateKPIs();
            showToast("Vaga liberada.", "success");

            sendUpdateToSheet({
                action: "update",
                id: id,
                status: 'LIVRE',
                patient: '', record: '', contract: '', regulated: null,
                procedure: '', detail: '', eye: ''
            });
        }, "Autorizar Cancelamento");
    });
}

function calculateFilteredStats() {
    const startInput = document.getElementById('dash-date-start');
    const endInput = document.getElementById('dash-date-end');
    let startDate = startInput && startInput.value ? startInput.value : selectedDateKey;
    let endDate = endInput && endInput.value ? endInput.value : startDate;
    if (startDate > endDate && endDate) endDate = startDate;

    let totalSlots = 0, occupiedSlots = 0, totalMarcacoes = 0, totalCirurgia = 0, totalLaser = 0;
    let counts = {
        Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        InternoTypes: {
            ESTADO: { Emergencia: 0, Projetos: 0 },
            SERRA: { Emergencia: 0, Projetos: 0 },
            SALGUEIRO: { Emergencia: 0, Projetos: 0 }
        },
        Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
    };
    let locationCounts = {};

    Object.keys(appointments).forEach(dateKey => {
        if (dateKey >= startDate && dateKey <= endDate) {
            const daySlots = appointments[dateKey];
            totalSlots += daySlots.length;
            daySlots.forEach(s => {
                if (s.status === 'OCUPADO') {
                    occupiedSlots++;
                    totalMarcacoes++;
                    let isLaser = s.specialty && s.specialty.toUpperCase().includes('LASER');
                    if (isLaser) totalLaser++; else totalCirurgia++;
                    const procs = getProceduresFromSlot(s);
                    const procsLen = procs.length > 0 ? procs.length : 1;
                    const loc = s.location ? s.location.trim() : "Outros";
                    if (!locationCounts[loc]) locationCounts[loc] = 0;
                    locationCounts[loc] += procsLen;
                    const c = s.contract ? s.contract.toUpperCase() : null;
                    if (!c) return;
                    if (CONTRACTS.MUNICIPAL.includes(c)) {
                        counts.Municipal.Total += procsLen;
                        if (counts.Municipal[c] !== undefined) counts.Municipal[c] += procsLen;
                    } else if (CONTRACTS.LOCALS.includes(c)) {
                        if (procs.length > 0) {
                            procs.forEach(p => {
                                if (p.regulated) {
                                    counts.Regulado.Total++;
                                    if (counts.Regulado[c] !== undefined) counts.Regulado[c]++;
                                } else {
                                    counts.Interno.Total++;
                                    if (counts.Interno[c] !== undefined) counts.Interno[c]++;
                                    if (p.type === 'Emergência' || !p.type) counts.InternoTypes[c].Emergencia++;
                                    else counts.InternoTypes[c].Projetos++;
                                }
                            });
                        } else {
                            counts.Interno.Total++;
                            if (counts.Interno[c] !== undefined) counts.Interno[c]++;
                            counts.InternoTypes[c].Emergencia++;
                        }
                    }
                }
            });
        }
    });
    return { total: totalSlots, occupied: occupiedSlots, counts, totalMarcacoes, totalCirurgia, totalLaser, startDate, endDate, locationCounts };
}

function updateCharts(stats) {
    const ctxLoc = document.getElementById('chart-location');
    const ctxContract = document.getElementById('chart-specialty');
    if (!ctxLoc || !ctxContract) return;

    const locLabels = Object.keys(stats.locationCounts || {});
    const locValues = Object.values(stats.locationCounts || {});
    const locColors = ['#0284c7', '#059669', '#d97706', '#7c3aed', '#db2777', '#475569'];

    if (chartLocInstance) {
        chartLocInstance.data.labels = locLabels;
        chartLocInstance.data.datasets[0].data = locValues;
        chartLocInstance.data.datasets[0].backgroundColor = locColors.slice(0, locLabels.length);
        chartLocInstance.update();
    } else {
        chartLocInstance = new Chart(ctxLoc, {
            type: 'doughnut',
            data: {
                labels: locLabels,
                datasets: [{
                    data: locValues,
                    backgroundColor: locColors.slice(0, locLabels.length),
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: 10 },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { usePointStyle: true, padding: 20, font: { family: "'Inter', sans-serif", size: 12, weight: '500' } }
                    }
                },
                cutout: '72%'
            }
        });
    }

    const barDataReg = [stats.counts.Regulado.ESTADO, stats.counts.Regulado.SERRA, stats.counts.Regulado.SALGUEIRO];
    const barDataInt = [stats.counts.Interno.ESTADO, stats.counts.Interno.SERRA, stats.counts.Interno.SALGUEIRO];

    if (chartSpecInstance) {
        chartSpecInstance.data.datasets[0].data = barDataReg;
        chartSpecInstance.data.datasets[1].data = barDataInt;
        chartSpecInstance.update();
    } else {
        chartSpecInstance = new Chart(ctxContract, {
            type: 'bar',
            data: {
                labels: ['Estado', 'Serra Talhada', 'Salgueiro'],
                datasets: [
                    { label: 'Regulados', data: barDataReg, backgroundColor: '#7c3aed', borderRadius: 6, maxBarThickness: 35, barPercentage: 0.6, categoryPercentage: 0.5 },
                    { label: 'Internos', data: barDataInt, backgroundColor: '#059669', borderRadius: 6, maxBarThickness: 35, barPercentage: 0.6, categoryPercentage: 0.5 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, padding: 20, font: { family: "'Inter', sans-serif", weight: '500' } } }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { font: { family: "'Inter', sans-serif", weight: '600' } } },
                    y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false }, ticks: { stepSize: 1, font: { family: "'Inter', sans-serif" } } }
                }
            }
        });
    }
}

function updateKPIs() {
    const stats = calculateFilteredStats();
    const { total, occupied, counts, totalMarcacoes, totalCirurgia, totalLaser } = stats;

    const totalReg = counts.Regulado.Total;
    const totalInt = counts.Interno.Total;
    const validBaseGov = (totalReg + totalInt) || 1;

    animateMetric('glb-marcacoes', totalMarcacoes);
    animateMetric('glb-cirurgia', totalCirurgia);
    animateMetric('glb-laser', totalLaser);

    const pctRegGlobal = (totalReg / validBaseGov) * 100;
    animateMetric('kpi-60-val', pctRegGlobal, true);
    document.getElementById('prog-60').style.width = Math.min(pctRegGlobal, 100) + '%';

    animateSubMetric('stat-estado', counts.Regulado.ESTADO, totalReg);
    animateSubMetric('stat-serra', counts.Regulado.SERRA, totalReg);
    animateSubMetric('stat-salgueiro', counts.Regulado.SALGUEIRO, totalReg);

    const pctIntGlobal = (totalInt / validBaseGov) * 100;
    animateMetric('kpi-40-val', pctIntGlobal, true);
    document.getElementById('prog-40').style.width = Math.min(pctIntGlobal, 100) + '%';

    animateSubMetric('stat-int-estado', counts.Interno.ESTADO, totalInt);
    animateSubMetric('stat-int-serra', counts.Interno.SERRA, totalInt);
    animateSubMetric('stat-int-salgueiro', counts.Interno.SALGUEIRO, totalInt);

    animateMetric('stat-recife', counts.Municipal.RECIFE);
    animateMetric('stat-jaboatao', counts.Municipal.JABOATÃO);
    animateMetric('kpi-mun-val', counts.Municipal.Total);

    const setTooltip = (id, c) => {
        const el = document.getElementById(id).parentElement;
        el.removeAttribute('title');
        el.classList.add('tooltip-container');

        let tooltip = el.querySelector('.custom-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'custom-tooltip';
            el.appendChild(tooltip);
        }

        const totalIntContrato = counts.Interno[c];
        if (totalIntContrato > 0) {
            const em = counts.InternoTypes[c].Emergencia;
            const pr = counts.InternoTypes[c].Projetos;
            tooltip.innerHTML = `
                <div style="font-weight:800; color:#e0f2fe; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:6px; margin-bottom:8px; text-transform:uppercase; font-size:0.7rem;">Detalhamento</div>
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Emergência:</span> <b>${em}</b></div>
                <div style="display:flex; justify-content:space-between;"><span>Projetos:</span> <b>${pr}</b></div>
            `;
            el.style.cursor = 'help';
            tooltip.style.display = 'block';
        } else {
            el.style.cursor = 'default';
            tooltip.style.display = 'none';
        }
    };

    setTooltip('stat-int-estado', 'ESTADO');
    setTooltip('stat-int-serra', 'SERRA');
    setTooltip('stat-int-salgueiro', 'SALGUEIRO');
    updateCharts(stats);
}

function generateDashboardPDF() {
    const stats = calculateFilteredStats();
    let monthVal = `${stats.startDate} a ${stats.endDate}`;
    const { total, occupied, counts } = stats;

    const totalReg = counts.Regulado.Total;
    const totalInt = counts.Interno.Total;
    const universeGov = totalReg + totalInt;
    const validBase = universeGov || 1;
    const pctOccupied = total > 0 ? (occupied / total * 100).toFixed(1) : "0.0";

    const content = document.createElement('div');
    content.innerHTML = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 20px;">
                <h1 style="color: #1e293b; font-size: 24px; margin: 0;">Relatório de Governança Cirúrgica</h1>
                <div style="color: #64748b; font-size: 14px; margin-top: 5px;">Período: ${monthVal}</div>
            </div>
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 30px;">
                <h3 style="margin-top:0; color:#475569; font-size:16px;">Visão Geral</h3>
                <p>Capacidade: ${total} | Ocupação: ${pctOccupied}% | Total Gov: ${universeGov}</p>
            </div>
            <div style="display:flex; gap:20px;">
                <div style="flex:1;">
                    <h3 style="color:#7c3aed;">Regulados (${((totalReg / validBase) * 100).toFixed(1)}%)</h3>
                    <p>Total: ${totalReg}</p>
                </div>
                <div style="flex:1;">
                    <h3 style="color:#059669;">Internos (${((totalInt / validBase) * 100).toFixed(1)}%)</h3>
                    <p>Total: ${totalInt}</p>
                </div>
            </div>
            <div style="margin-top:40px; font-size:10px; color:#94a3b8; text-align:center;">
                Gerado em ${new Date().toLocaleString()}
            </div>
        </div>
    `;

    const opt = { margin: 10, filename: `Relatorio_Gov_${monthVal}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    setLoading(true);
    html2pdf().set(opt).from(content).save().then(() => setLoading(false));
}

let messageCallback = null;
function showMessageModal(title, message, type = 'success', onConfirm = null) {
    const modal = document.getElementById('message-modal');
    const iconEl = document.getElementById('msg-icon');
    const btns = document.getElementById('msg-actions');
    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-body').innerHTML = message;
    messageCallback = onConfirm;
    btns.style.display = type === 'loading' ? 'none' : 'flex';

    const icons = {
        'success': { color: '#16a34a', bg: '#dcfce7', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` },
        'confirm': { color: '#0284c7', bg: '#e0f2fe', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg>` },
        'loading': { color: '#0284c7', bg: '#f0f9ff', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>` }
    };

    const style = icons[type] || icons['success'];
    iconEl.style.color = style.color; iconEl.style.background = style.bg; iconEl.innerHTML = style.svg;

    const btnConfirm = document.getElementById('msg-btn-confirm');
    const btnCancel = document.getElementById('msg-btn-cancel');
    if (type === 'confirm') {
        btnCancel.style.display = 'block';
        btnConfirm.innerText = 'Confirmar';
        btnConfirm.onclick = () => { if (messageCallback) messageCallback(); };
    } else {
        btnCancel.style.display = 'none';
        btnConfirm.innerText = 'OK';
        btnConfirm.onclick = closeMessageModal;
    }
    modal.classList.add('open');
}

function closeMessageModal() { document.getElementById('message-modal').classList.remove('open'); messageCallback = null; }

function openExportModal() {
    const today = new Date();
    const y = today.getFullYear(), m = String(today.getMonth() + 1).padStart(2, '0');
    document.getElementById('export-start').value = `${y}-${m}-01`;
    document.getElementById('export-end').value = `${y}-${m}-${new Date(y, today.getMonth() + 1, 0).getDate()}`;
    document.getElementById('export-modal').classList.add('open');
}

function closeExportModal() { document.getElementById('export-modal').classList.remove('open'); }

async function executeExport() {
    let startDate = document.getElementById('export-start').value;
    let endDate = document.getElementById('export-end').value;
    if (!startDate || !endDate) return showToast('Selecione as datas.', 'warning');
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];

    const btn = document.querySelector('#export-modal .btn-primary');
    const originalText = btn.innerText;
    btn.innerHTML = `Gerando...`; btn.disabled = true;

    try {
        let startD = new Date(startDate + "T00:00:00"), endD = new Date(endDate + "T00:00:00");
        let monthsToFetch = [];
        let currentD = new Date(startD);
        while (currentD <= endD || (currentD.getMonth() === endD.getMonth() && currentD.getFullYear() === endD.getFullYear())) {
            let mKey = `${currentD.getFullYear()}-${String(currentD.getMonth() + 1).padStart(2, '0')}`;
            if (!monthsToFetch.includes(mKey)) monthsToFetch.push(mKey);
            currentD.setMonth(currentD.getMonth() + 1);
        }
        for (const mKey of monthsToFetch) await syncMonthData(`${mKey}-01`);

        const locFilter = document.getElementById('location-filter').value;
        const roomFilter = document.getElementById('room-filter').value;
        const specFilter = document.getElementById('specialty-filter') ? document.getElementById('specialty-filter').value : 'ALL';

        let slots = [];
        Object.keys(appointments).forEach(dateKey => {
            if (dateKey >= startDate && dateKey <= endDate) slots = slots.concat(appointments[dateKey]);
        });
        slots = slots.filter(s => {
            if (String(s.status).toUpperCase() === 'EXCLUIDO') return false;
            if (locFilter !== 'ALL' && s.location !== locFilter) return false;
            if (roomFilter !== 'ALL' && String(s.room) !== roomFilter) return false;
            if (specFilter !== 'ALL' && s.specialty !== specFilter) return false;
            return true;
        });

        if (slots.length === 0) return showToast('Nada encontrado.', 'warning');
        slots.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

        const headers = ["Data", "Hora", "Unidade", "Sala", "Tipo", "Status", "Paciente", "Prontuario", "Contrato", "Regulado", "Medico", "Procedimento", "AtualizadoPor"];
        const rows = slots.map(s => {
            let pName = s.procedure;
            try { if (s.procedure.startsWith('[')) pName = JSON.parse(s.procedure)[0].name; } catch (e) { }
            return [formatDateBR(s.date), s.time, s.location, s.room, s.specialty, s.status, s.patient, s.record, s.contract, s.regulated ? 'SIM' : 'NÃO', s.doctor, pName, s.updatedBy || s.createdBy]
                .map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(';');
        });

        const csv = "\uFEFF" + [headers.join(';'), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = `Relatorio_${startDate}_${endDate}.csv`;
        link.click();
        closeExportModal();
    } catch (err) { showToast('Erro ao exportar.', 'error'); } finally { btn.innerText = originalText; btn.disabled = false; }
}

window.onclick = function (e) {
    // A linha do login-modal foi removida para impedir que feche ao clicar fora
    if (e.target === document.getElementById('booking-modal')) closeModal();
    if (e.target === document.getElementById('message-modal')) closeMessageModal();
    if (e.target === document.getElementById('export-modal')) closeExportModal();
}

initData();