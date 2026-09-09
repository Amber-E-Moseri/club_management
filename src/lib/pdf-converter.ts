import { supabase } from './supabase';

type PdfJsViewport = { width: number; height: number };
type PdfJsPage = {
  getViewport: (options: { scale: number }) => PdfJsViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }) => {
    promise: Promise<void>;
  };
};
type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
};
type PdfJs = {
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument: (source: { data: ArrayBuffer }) => { promise: Promise<PdfJsDocument> };
};

declare global {
  interface Window {
    pdfjsLib?: PdfJs;
  }
}

export interface PageRange {
  day: number;
  startPage: number;
  endPage: number;
  title?: string;
}

export interface ConvertedDayImage {
  day: number;
  pageRange: string;
  title?: string;
  blob: Blob;
  fileName: string;
}

export interface UploadedDayImage extends ConvertedDayImage {
  imageUrl: string;
}

export type ConversionStatus =
  | 'analyzing'
  | 'converting'
  | 'uploading'
  | 'complete';

export interface ConversionProgress {
  status: ConversionStatus;
  current: number;
  total: number;
  message: string;
}

export function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

export function formatPageRange(range: PageRange): string {
  return range.startPage === range.endPage
    ? String(range.startPage)
    : `${range.startPage}-${range.endPage}`;
}

export function detectPageRanges(totalPages: number, totalDays: number): PageRange[] {
  if (totalPages < 1) throw new Error('PDF must contain at least one page.');
  if (totalDays < 28 || totalDays > 31) throw new Error('Devotional months must have 28 to 31 days.');

  const basePages = Math.floor(totalPages / totalDays);
  const remainder = totalPages % totalDays;
  const ranges: PageRange[] = [];
  let pageCursor = 1;

  for (let day = 1; day <= totalDays; day += 1) {
    const pagesForDay = Math.max(1, basePages + (day <= remainder ? 1 : 0));
    const startPage = Math.min(pageCursor, totalPages);
    const endPage = Math.min(pageCursor + pagesForDay - 1, totalPages);
    ranges.push({ day, startPage, endPage });
    pageCursor = endPage + 1;
  }

  return ranges;
}

export async function analyzePdfStructure(file: File, month: number, year: number) {
  const pdf = await loadPdf(file);
  const totalDays = getDaysInMonth(month, year);
  return {
    totalPages: pdf.numPages,
    totalDays,
    ranges: detectPageRanges(pdf.numPages, totalDays),
  };
}

export async function convertPdfToDailyImages(
  file: File,
  ranges: PageRange[],
  onProgress?: (progress: ConversionProgress) => void
): Promise<ConvertedDayImage[]> {
  const pdf = await loadPdf(file);
  const total = ranges.length;
  const images: ConvertedDayImage[] = [];

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    onProgress?.({
      status: 'converting',
      current: index + 1,
      total,
      message: `Converting Day ${range.day} pages ${formatPageRange(range)}...`,
    });

    const blob = await renderRangeToJpeg(pdf, range);
    images.push({
      day: range.day,
      pageRange: formatPageRange(range),
      title: range.title,
      blob,
      fileName: `day-${String(range.day).padStart(2, '0')}.jpg`,
    });
  }

  return images;
}

export async function uploadImageToGoogleDrive(
  image: ConvertedDayImage,
  context: { month: number; year: number; bookTitle: string }
): Promise<string> {
  const endpoint = process.env.REACT_APP_GOOGLE_DRIVE_UPLOAD_ENDPOINT;
  if (!endpoint) {
    throw new Error('Google Drive upload endpoint is not configured.');
  }

  const form = new FormData();
  form.append('file', image.blob, image.fileName);
  form.append('month', String(context.month));
  form.append('year', String(context.year));
  form.append('bookTitle', context.bookTitle);
  form.append('day', String(image.day));

  const response = await fetch(endpoint, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Google Drive upload failed for Day ${image.day}.`);

  const body = (await response.json()) as { url?: string; webViewLink?: string; publicUrl?: string };
  const url = body.url ?? body.webViewLink ?? body.publicUrl;
  if (!url) throw new Error('Google Drive upload response did not include a URL.');
  return url;
}

export async function uploadImageToSupabaseStorage(
  image: ConvertedDayImage,
  context: { month: number; year: number; devotionalId: string }
): Promise<string> {
  const path = `${context.year}/${String(context.month).padStart(2, '0')}/${context.devotionalId}/${image.fileName}`;
  const { error } = await supabase.storage
    .from('devotional-images')
    .upload(path, image.blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('devotional-images').getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadConvertedImages(
  images: ConvertedDayImage[],
  context: { month: number; year: number; bookTitle: string; devotionalId?: string; provider: 'google-drive' | 'supabase' },
  onProgress?: (progress: ConversionProgress) => void
): Promise<UploadedDayImage[]> {
  const uploaded: UploadedDayImage[] = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    onProgress?.({
      status: 'uploading',
      current: index + 1,
      total: images.length,
      message: `Uploading Day ${image.day}...`,
    });

    const imageUrl =
      context.provider === 'google-drive'
        ? await uploadImageToGoogleDrive(image, context)
        : await uploadImageToSupabaseStorage(image, {
            month: context.month,
            year: context.year,
            devotionalId: context.devotionalId ?? 'pending',
          });

    uploaded.push({ ...image, imageUrl });
  }

  onProgress?.({
    status: 'complete',
    current: images.length,
    total: images.length,
    message: 'All devotional pages are ready.',
  });

  return uploaded;
}

async function loadPdf(file: File): Promise<PdfJsDocument> {
  if (!window.pdfjsLib) {
    throw new Error('PDF.js is not loaded. Add PDF.js to the app shell or use a server conversion endpoint.');
  }

  if (window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const data = await file.arrayBuffer();
  return window.pdfjsLib.getDocument({ data }).promise;
}

async function renderRangeToJpeg(pdf: PdfJsDocument, range: PageRange): Promise<Blob> {
  const pages: HTMLCanvasElement[] = [];

  for (let pageNumber = range.startPage; pageNumber <= range.endPage; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push(await renderPage(page));
  }

  const width = pages.reduce((sum, canvas) => sum + canvas.width, 0);
  const height = Math.max(...pages.map((canvas) => canvas.height));
  const spread = document.createElement('canvas');
  spread.width = width;
  spread.height = height;

  const ctx = spread.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context for PDF conversion.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let x = 0;
  pages.forEach((canvas) => {
    const y = Math.floor((height - canvas.height) / 2);
    ctx.drawImage(canvas, x, y);
    x += canvas.width;
  });

  return new Promise((resolve, reject) => {
    spread.toBlob(
      (blob) => {
        if (!blob) reject(new Error(`Could not render Day ${range.day} as JPG.`));
        else resolve(blob);
      },
      'image/jpeg',
      0.85
    );
  });
}

async function renderPage(page: PdfJsPage): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new Error('Could not create canvas context for PDF page.');

  await page.render({ canvasContext, viewport }).promise;
  return canvas;
}
