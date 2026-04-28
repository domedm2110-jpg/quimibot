require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── BASE DE DATOS JSON ───────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "quimibot-data.json");

function loadDB() {
  // Crear directorio si no existe
  const dir = require('path').dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const empty = { alumnos: [], interacciones: [], sesiones: [], examenes: [], resultados_examen: [], encuestas: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    const d = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!d.examenes)          d.examenes = [];
    if (!d.resultados_examen) d.resultados_examen = [];
    if (!d.encuestas)         d.encuestas = [];
    return d;
  } catch { return { alumnos: [], interacciones: [], sesiones: [], examenes: [], resultados_examen: [], encuestas: [] }; }
}

function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
function nowISO()      { return new Date().toISOString(); }
function makeCode()    { return Math.random().toString(36).substring(2,8).toUpperCase(); }

// ─── SYSTEM PROMPTS ───────────────────────────────────────────────────────────
const SYSTEM_NORMAL = `Eres QuimiBot, tutor de Química General para estudiantes de 1er año de Ingeniería Biomédica de la Universidad Católica de Santa María, Arequipa, Perú.

== TU MISIÓN ==
Guiar a los estudiantes a encontrar las respuestas por sí mismos usando el método socrático MIXTO: primero guías con preguntas, y solo si el alumno está muy perdido tras 2-3 intentos, explicas el procedimiento paso a paso.

== TEMAS DEL CURSO (SOLO ESTOS) ==
1. Reacciones químicas — tipos (síntesis, descomposición, desplazamiento, doble desplazamiento, combustión) y balanceo de ecuaciones
2. Estequiometría — mol, masa molar, balanceo, reactivo limitante, rendimiento de reacción, relaciones molares
3. Volumetría de precipitación — método de Mohr, Volhard, Fajans; análisis de cloruros en agua
4. Volumetría por complejometría — EDTA, dureza del agua, indicadores metalocrómicos, cálculo de dureza
5. Celdas galvánicas — construcción, ánodo/cátodo, potencial de celda, semirreacciones, aplicaciones biomédicas

Si te preguntan algo fuera de estos 5 temas, di amablemente: "Ese tema está fuera del programa del curso. ¿Puedo ayudarte con reacciones, estequiometría, volumetría o celdas galvánicas? 🧪"

== MÉTODO SOCRÁTICO MIXTO ==

FASE 1 — SIEMPRE EMPIEZA ASÍ:
- NUNCA des la respuesta directa al primer intento
- Guía con preguntas: "¿Qué datos tienes?", "¿Qué te están pidiendo?", "¿Qué fórmula relaciona esas magnitudes?"
- Si responde correcto: felicítalo brevemente y profundiza con otra pregunta 🎉
- Si responde incorrecto: NO lo corrijas directamente. Di "¿Estás seguro? Piensa en..." y da una pista pequeña

FASE 2 — SI ESTÁ MUY PERDIDO (tras 2-3 intentos fallidos o si dice "no entiendo", "no sé", "ayuda"):
- Di: "No te preocupes, vamos paso a paso 😊"
- Resuelve el procedimiento completo mostrando cada operación
- Explica el razonamiento en cada paso
- Al final pregunta si quedó claro y propón un ejercicio similar para practicar

== REGLAS ==
- Responde SIEMPRE en español
- Usa emojis ocasionalmente para ser cercano (🧪 ⚗️ ✅ 💡) pero sin exagerar
- Muestra SIEMPRE las unidades en los cálculos
- Relaciona con Ingeniería Biomédica cuando sea posible (dureza del agua en equipos médicos, celdas en marcapasos, etc.)
- Sé alentador, paciente y nunca condescendiente
- Para fórmulas usa formato texto: H2O, CO2, NaCl, EDTA, AgNO3, etc.`;

const SYSTEM_EXAMEN = `Eres QuimiBot en MODO EXAMEN con retroalimentación inmediata.

== CONTEXTO ==
El profesor ha preparado preguntas de Química General. Se te indica la pregunta actual y la respuesta del alumno. Evalúa y da retroalimentación completa.

== REGLAS ==
1. Evalúa la respuesta del alumno a la pregunta indicada.
2. Da retroalimentación inmediata: explica qué estuvo bien, qué faltó, y cuál es la respuesta/procedimiento correcto.
3. NO incluyas videos ni papers.
4. Muestra el procedimiento correcto paso a paso cuando sea un problema numérico.
5. Sé alentador y educativo.

== FORMATO ESTRICTO ==

Si CORRECTA → [OK]
✅ ¡Excelente! Respuesta correcta.
📋 RETROALIMENTACIÓN: [explica por qué es correcto + dato extra relevante para Ingeniería Biomédica]

Si PARCIALMENTE CORRECTA → [PARTIAL]
⚠️ ¡Vas por buen camino!
✔️ LO QUE ESTUVO BIEN: [qué acertó]
➕ LO QUE FALTÓ: [qué le faltó]
📖 RESPUESTA COMPLETA: [solución correcta paso a paso]

Si INCORRECTA → [WRONG]
❌ No es correcto, pero vamos a aprenderlo.
📖 SOLUCIÓN CORRECTA:
[procedimiento paso a paso con cada operación explicada]
💡 CLAVE PARA RECORDAR: [truco o concepto clave]

Responde siempre en español. Sé justo, claro y alentador.`;

// ─── REGISTRO ────────────────────────────────────────────────────────────────
app.post("/api/registro", (req, res) => {
  try {
    const { nombre, codigo, curso } = req.body;
    if (!nombre || !codigo) return res.status(400).json({ error: "Nombre y código requeridos" });
    const db = loadDB();
    let alumno = db.alumnos.find(a => a.codigo === codigo.trim().toUpperCase());
    if (!alumno) {
      alumno = { id: Date.now(), nombre: nombre.trim(), codigo: codigo.trim().toUpperCase(), curso: curso || "", creado_en: nowISO() };
      db.alumnos.push(alumno);
    } else { alumno.nombre = nombre.trim(); alumno.curso = curso || alumno.curso; }
    const sesion = { id: Date.now()+1, alumno_id: alumno.id, alumno_codigo: alumno.codigo, iniciada_en: nowISO(), finalizada_en: null, total_msgs: 0 };
    db.sesiones.push(sesion);
    saveDB(db);
    res.json({ ok: true, alumno, sesionId: sesion.id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error al registrar" }); }
});

app.post("/api/cerrar-sesion", (req, res) => {
  try {
    const { sesionId, totalMsgs } = req.body;
    if (sesionId) {
      const db = loadDB();
      const s = db.sesiones.find(s => s.id === sesionId);
      if (s) { s.finalizada_en = nowISO(); s.total_msgs = totalMsgs || 0; }
      saveDB(db);
    }
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// ─── CHAT NORMAL ──────────────────────────────────────────────────────────────
app.post("/api/chat", (req, res) => {
  const { messages, alumno, sesionId, modo, mensajeUsuario } = req.body;
  if (!messages) return res.status(400).json({ error: "Mensajes requeridos" });

  fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1500, system: SYSTEM_NORMAL, messages }),
  })
    .then(r => r.json())
    .then(data => {
      const reply = data.content?.[0]?.text || "";
      if (alumno?.id) {
        try {
          const db = loadDB();
          db.interacciones.push({ id: Date.now(), alumno_id: alumno.id, alumno_nombre: alumno.nombre, alumno_codigo: alumno.codigo, modo: modo || "general", mensaje_usuario: (mensajeUsuario || "").substring(0,300), respuesta_bot: reply.substring(0,500), timestamp: nowISO() });
          saveDB(db);
        } catch (e) { console.error(e); }
      }
      res.json({ content: reply });
    })
    .catch(err => { console.error(err); res.status(500).json({ error: "Error API" }); });
});

// ─── EXAMEN ───────────────────────────────────────────────────────────────────
app.post("/api/examen/crear", (req, res) => {
  const DASH_PASS = process.env.DASHBOARD_PASSWORD || "profesor123";
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  try {
    const { nombre, descripcion, total_preguntas, curso } = req.body;
    const preguntas = (req.body.preguntas || []).filter(p => p.trim());
    const examen = { id: Date.now(), nombre: nombre || "Examen", descripcion: descripcion || "", codigo: makeCode(), total_preguntas: preguntas.length || total_preguntas || 5, preguntas, curso: curso || "", activo: true, creado_en: nowISO() };
    const db = loadDB();
    db.examenes.push(examen);
    saveDB(db);
    res.json({ ok: true, examen });
  } catch (err) { res.status(500).json({ error: "Error creando examen" }); }
});

app.post("/api/examen/verificar", (req, res) => {
  try {
    const { codigo } = req.body;
    const db = loadDB();
    const examen = db.examenes.find(e => e.codigo === codigo.trim().toUpperCase() && e.activo);
    if (!examen) return res.status(404).json({ error: "Código inválido o examen inactivo" });
    res.json({ ok: true, examen: { id: examen.id, nombre: examen.nombre, descripcion: examen.descripcion, total_preguntas: examen.total_preguntas, preguntas: examen.preguntas || [] } });
  } catch { res.status(500).json({ error: "Error" }); }
});

app.post("/api/examen/chat", (req, res) => {
  const { messages, alumno, examenId, preguntaNum, mensajeUsuario } = req.body;
  if (!messages) return res.status(400).json({ error: "Mensajes requeridos" });

  fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000, system: SYSTEM_EXAMEN, messages }),
  })
    .then(r => r.json())
    .then(data => {
      const reply = data.content?.[0]?.text || "";
      let resultado = "ask";
      if      (reply.startsWith("[OK]"))      resultado = "ok";
      else if (reply.startsWith("[WRONG]"))   resultado = "wrong";
      else if (reply.startsWith("[PARTIAL]")) resultado = "partial";
      if (alumno?.id && examenId && resultado !== "ask") {
        try {
          const db = loadDB();
          db.resultados_examen.push({ id: Date.now(), examen_id: examenId, alumno_id: alumno.id, alumno_nombre: alumno.nombre, alumno_codigo: alumno.codigo, pregunta_num: preguntaNum || 1, mensaje_usuario: (mensajeUsuario||"").substring(0,300), resultado, timestamp: nowISO() });
          saveDB(db);
        } catch (e) { console.error(e); }
      }
      res.json({ content: reply, resultado });
    })
    .catch(err => { res.status(500).json({ error: "Error API" }); });
});

app.post("/api/examen/finalizar", (req, res) => {
  try {
    const { examenId, alumno, correctas, parciales, incorrectas, total } = req.body;
    const db = loadDB();
    const examen = db.examenes.find(e => e.id === examenId);
    const puntaje = total > 0 ? Math.round(((correctas + parciales * 0.5) / total) * 20 * 10) / 10 : 0;
    db.resultados_examen.push({ id: Date.now(), examen_id: examenId, examen_nombre: examen?.nombre || "", alumno_id: alumno.id, alumno_nombre: alumno.nombre, alumno_codigo: alumno.codigo, alumno_curso: alumno.curso, correctas, parciales, incorrectas, total, puntaje, tipo: "resumen", timestamp: nowISO() });
    saveDB(db);
    res.json({ ok: true, puntaje });
  } catch { res.status(500).json({ error: "Error" }); }
});

app.post("/api/examen/estado", (req, res) => {
  const DASH_PASS = process.env.DASHBOARD_PASSWORD || "profesor123";
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  try {
    const { examenId, activo } = req.body;
    const db = loadDB();
    const ex = db.examenes.find(e => e.id === examenId);
    if (ex) ex.activo = activo;
    saveDB(db);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Error" }); }
});

// ─── ENCUESTA ────────────────────────────────────────────────────────────────
app.post("/api/encuesta", (req, res) => {
  try {
    const { alumno, p1, p2, p3, p4, comentario, sesionId } = req.body;
    const db = loadDB();
    db.encuestas.push({ id: Date.now(), alumno_id: alumno?.id, alumno_nombre: alumno?.nombre, alumno_codigo: alumno?.codigo, alumno_curso: alumno?.curso, p1_utilidad: p1, p2_facilidad: p2, p3_recomendaria: p3, p4_aprendizaje: p4, comentario: (comentario || "").substring(0,500), sesion_id: sesionId, timestamp: nowISO() });
    saveDB(db);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Error" }); }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const DASH_PASS = process.env.DASHBOARD_PASSWORD || "profesor123";

app.post("/api/dashboard/auth", (req, res) => {
  if (req.body.password === DASH_PASS) res.json({ ok: true });
  else res.status(401).json({ error: "Contraseña incorrecta" });
});

app.get("/api/dashboard/stats", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  const db = loadDB();
  const hoy = new Date().toISOString().slice(0,10);
  const totales = { alumnos: db.alumnos.length, sesiones: db.sesiones.length, interacciones: db.interacciones.length, hoy: db.interacciones.filter(i => i.timestamp?.startsWith(hoy)).length };
  const modeMap = {};
  db.interacciones.forEach(i => { modeMap[i.modo] = (modeMap[i.modo]||0)+1; });
  const modos = Object.entries(modeMap).map(([modo,n]) => ({modo,n})).sort((a,b)=>b.n-a.n);
  const diaMap = {};
  const hace30 = new Date(Date.now()-30*24*3600*1000).toISOString().slice(0,10);
  db.interacciones.filter(i=>i.timestamp>=hace30).forEach(i => { const d=i.timestamp?.slice(0,10); if(d) diaMap[d]=(diaMap[d]||0)+1; });
  const actividadPorDia = Object.entries(diaMap).map(([dia,n])=>({dia,n})).sort((a,b)=>a.dia.localeCompare(b.dia));
  const rankingAlumnos = db.alumnos.map(a => {
    const inters = db.interacciones.filter(i=>i.alumno_id===a.id);
    return { nombre:a.nombre, codigo:a.codigo, curso:a.curso, creado_en:a.creado_en, total_interacciones:inters.length, ultima_actividad:inters.length?inters[inters.length-1].timestamp:null };
  }).sort((a,b)=>b.total_interacciones-a.total_interacciones);
  const ultimasInteracciones = db.interacciones.slice(-50).reverse().map(i=>({ alumno_nombre:i.alumno_nombre, alumno_codigo:i.alumno_codigo, modo:i.modo, timestamp:i.timestamp }));
  const examenes = db.examenes.map(ex => {
    const resultados_ex = db.resultados_examen.filter(r => r.examen_id === ex.id && r.tipo === "resumen");
    const prom = resultados_ex.length ? Math.round(resultados_ex.reduce((s,r)=>s+r.puntaje,0)/resultados_ex.length*10)/10 : null;
    return { ...ex, total_rendidos: resultados_ex.length, promedio_puntaje: prom, resultados: resultados_ex };
  }).sort((a,b)=>b.id-a.id);
  const enc = db.encuestas;
  const encuesta_resumen = enc.length ? { total: enc.length, p1_utilidad: Math.round(enc.reduce((s,e)=>s+(e.p1_utilidad||0),0)/enc.length*10)/10, p2_facilidad: Math.round(enc.reduce((s,e)=>s+(e.p2_facilidad||0),0)/enc.length*10)/10, p3_recomendaria: Math.round(enc.reduce((s,e)=>s+(e.p3_recomendaria||0),0)/enc.length*10)/10, p4_aprendizaje: Math.round(enc.reduce((s,e)=>s+(e.p4_aprendizaje||0),0)/enc.length*10)/10, comentarios: enc.filter(e=>e.comentario).slice(-10).map(e=>({nombre:e.alumno_nombre,texto:e.comentario,fecha:e.timestamp?.slice(0,10)})) } : null;
  res.json({ totales, modos, actividadPorDia, rankingAlumnos, ultimasInteracciones, examenes, encuesta_resumen });
});

app.get("/api/dashboard/export", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  const db = loadDB();
  const header = "Nombre,Código,Curso,Modo,Mensaje,Fecha";
  const rows = db.interacciones.map(i => {
    const a = db.alumnos.find(a=>a.id===i.alumno_id)||{};
    return [a.nombre||i.alumno_nombre||"",a.codigo||i.alumno_codigo||"",a.curso||"",i.modo||"",`"${(i.mensaje_usuario||"").replace(/"/g,"'")}"`,i.timestamp||""].join(",");
  });
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=quimibot-datos.csv");
  res.send([header,...rows].join("\n"));
});

app.get("/api/dashboard/export-examenes", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  const db = loadDB();
  const header = "Examen,Alumno,Código,Curso,Correctas,Parciales,Incorrectas,Total,Puntaje,Fecha";
  const rows = db.resultados_examen.filter(r=>r.tipo==="resumen").map(r =>
    [r.examen_nombre||"",r.alumno_nombre||"",r.alumno_codigo||"",r.alumno_curso||"",r.correctas||0,r.parciales||0,r.incorrectas||0,r.total||0,r.puntaje||0,r.timestamp?.slice(0,10)||""].join(",")
  );
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=quimibot-examenes.csv");
  res.send([header,...rows].join("\n"));
});

app.get("/dashboard",(req,res)=>res.sendFile(path.join(__dirname,"public","dashboard.html")));
app.get("/health",   (req,res)=>res.json({ok:true,ts:new Date().toISOString()}));
app.get("*",         (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🧪 QuimiBot corriendo en http://localhost:${PORT}`));
