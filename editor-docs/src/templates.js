// Plantillas para empezar un documento. Son HTML simple: se convierten al formato del editor.
const today = () => new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

export const TEMPLATES = [
  {
    id: 'blanco', name: 'En blanco', hint: 'Documento vacío',
    html: () => '<p></p>',
  },
  {
    id: 'informe-ensayo', name: 'Informe de ensayo', hint: 'Objetivo, montaje, resultados',
    html: () => `
      <h1>Informe de ensayo: [nombre del ensayo]</h1>
      <p><strong>Proyecto:</strong> [proyecto] · <strong>Fecha:</strong> ${today()} · <strong>Responsables:</strong> [nombres]</p>
      <h2>1. Objetivo</h2><p>Qué queremos comprobar con este ensayo.</p>
      <h2>2. Materiales y montaje</h2><ul><li><p>Componente o equipo</p></li><li><p>Instrumentos de medición</p></li></ul>
      <h2>3. Procedimiento</h2><ol><li><p>Primer paso</p></li><li><p>Segundo paso</p></li></ol>
      <h2>4. Resultados</h2>
      <table><tbody><tr><th><p>Medición</p></th><th><p>Esperado</p></th><th><p>Obtenido</p></th></tr>
      <tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
      <h2>5. Análisis</h2><p>Qué salió bien, qué falló y por qué.</p>
      <h2>6. Conclusiones y próximos pasos</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Próxima acción</p></li></ul>`,
  },
  {
    id: 'acta', name: 'Acta de reunión', hint: 'Temas, decisiones y tareas',
    html: () => `
      <h1>Reunión de equipo</h1>
      <p><strong>Fecha:</strong> ${today()} · <strong>Lugar:</strong> Taller AeroGlobETec</p>
      <p><strong>Presentes:</strong> [nombres]</p>
      <h2>Temas</h2><ol><li><p>Tema 1</p></li><li><p>Tema 2</p></li></ol>
      <h2>Decisiones</h2><ul><li><p>Decisión</p></li></ul>
      <h2>Tareas</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Tarea · responsable · fecha</p></li></ul>
      <h2>Próxima reunión</h2><p>[fecha y hora]</p>`,
  },
  {
    id: 'informe-tecnico', name: 'Informe técnico', hint: 'Con índice y secciones',
    html: () => `
      <h1 style="text-align:center">[Título del informe]</h1>
      <p style="text-align:center">Taller AeroGlobETec · ETec Universidad de Mendoza</p>
      <p style="text-align:center">${today()}</p>
      <div data-page-break></div>
      <div data-toc></div>
      <div data-page-break></div>
      <h1>Introducción</h1><p>Contexto y motivación del trabajo.</p>
      <h1>Desarrollo</h1><h2>Diseño</h2><p></p><h2>Construcción</h2><p></p><h2>Pruebas</h2><p></p>
      <h1>Conclusiones</h1><p></p>
      <h1>Referencias</h1><ol><li><p></p></li></ol>`,
  },
  {
    id: 'propuesta', name: 'Propuesta de proyecto', hint: 'Problema, objetivos, plan',
    html: () => `
      <h1>Propuesta: [nombre del proyecto]</h1>
      <h2>El problema</h2><p>Qué necesidad o desafío resuelve.</p>
      <h2>Objetivos</h2><ul><li><p>Objetivo general</p></li><li><p>Objetivos específicos</p></li></ul>
      <h2>Cómo lo vamos a hacer</h2><p></p>
      <h2>Plan de trabajo</h2>
      <table><tbody><tr><th><p>Etapa</p></th><th><p>Qué incluye</p></th><th><p>Fecha</p></th></tr>
      <tr><td><p>1. Diseño</p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>2. Prototipo</p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>3. Pruebas</p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
      <h2>Materiales y presupuesto</h2><p></p>
      <h2>Equipo</h2><p></p>`,
  },
];

// Las mismas plantillas para Google Docs: Google convierte el HTML, pero no entiende los
// bloques propios del editor (salto de página, índice, lista de tareas). Se pasan a algo equivalente.
export function forGoogle(html) {
  return '<html><body>' + String(html)
    .replace(/<div data-page-break><\/div>/g, '<p style="page-break-before:always"></p>')
    .replace(/<div data-toc><\/div>/g, '<p><em>Índice: en Google Docs, Insertar → Índice.</em></p>')
    .replace(/<ul data-type="taskList">/g, '<ul style="list-style:none">')
    .replace(/<li data-type="taskItem" data-checked="true"><p>/g, '<li><p>☑ ')
    .replace(/<li data-type="taskItem" data-checked="false"><p>/g, '<li><p>☐ ')
    + '</body></html>';
}

export const googleTemplate = (id) => {
  const t = TEMPLATES.find(x => x.id === id);
  return t && t.id !== 'blanco' ? forGoogle(t.html()) : null;
};
