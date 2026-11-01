import Script from 'next/script';

export function ThemeInit() {
  return (
    <Script id="theme-init" strategy="beforeInteractive">
      {`(function(){var t=localStorage.getItem('yourpedia-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';})()`}
    </Script>
  );
}
