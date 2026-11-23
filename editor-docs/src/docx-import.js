// Importa un archivo de Word (.docx) y lo pasa a HTML para el editor (con la librería mammoth).
// Las imágenes del .docx se suben como las demás imágenes del documento.
export async function importDocx(file, uploadImage) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => h2:fresh",
      "p[style-name='Título'] => h1:fresh",
      "p[style-name='Subtítulo'] => h2:fresh",
    ],
    convertImage: mammoth.images.imgElement(async (image) => {
      const b64 = await image.read('base64');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: image.contentType });
      const ext = (image.contentType.split('/')[1] || 'png').replace('jpeg', 'jpg');
      return { src: await uploadImage(new File([blob], `imagen.${ext}`, { type: image.contentType })) };
    }),
  });
  return result.value;
}
