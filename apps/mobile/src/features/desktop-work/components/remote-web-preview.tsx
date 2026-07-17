'use dom';

export default function RemoteWebPreview({ content }: { content: string; dom?: import('expo/dom').DOMProps }) {
  return (
    <iframe
      title="Remote file preview"
      sandbox=""
      srcDoc={content}
      style={{ width: '100%', minHeight: 480, border: 0, background: '#ffffff' }}
    />
  );
}
