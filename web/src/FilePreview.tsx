import { useEffect, useState } from 'react';

import { type StoredFile, fileUrl } from './api';

const TEXT_PREVIEW_LIMIT = 200_000;

export function FilePreview({ file }: { file: StoredFile }) {
  const url = fileUrl(file);
  const kind = previewKind(file.mimeType);
  return (
    <figure className="file">
      {kind === 'image' && <img src={url} alt={file.name} />}
      {kind === 'pdf' && <iframe src={url} title={file.name} />}
      {kind === 'text' && <TextPreview url={url} />}
      <figcaption>
        <a href={url} target="_blank" rel="noreferrer" download={kind === 'none' ? file.name : undefined}>
          {file.name}
        </a>
      </figcaption>
    </figure>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => res.text())
      .then((body) => !cancelled && setText(body.length > TEXT_PREVIEW_LIMIT ? body.slice(0, TEXT_PREVIEW_LIMIT) + '\n…' : body))
      .catch(() => !cancelled && setText('（読み込めませんでした）'));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return <pre className="text-preview">{text ?? '読み込み中…'}</pre>;
}

function previewKind(mimeType: string): 'image' | 'pdf' | 'text' | 'none' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/') || mimeType.startsWith('application/json')) return 'text';
  return 'none';
}
