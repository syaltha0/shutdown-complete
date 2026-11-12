// The words of the sign-in tutorial film, in every language. The sign-in page uses the titles for the progress bars;
// tools/tutorial/render.mjs draws the titles (as chapter cards) and the steps (as captions) into the film itself,
// so after changing a word here run `npm run tutorial:render` (no new recording is needed) and `npm run build`.
export const REEL = {
  en: {
    label: 'How Shutdown Complete works, in five short chapters',
    scenes: [
      { title: 'Give every hour a plan', steps: ['Drag across the hours', 'Name the block'] },
      { title: 'When the day breaks, redraw it', steps: ['Revise from now', 'The rest moves to the next column'] },
      { title: 'Focus inside the block', steps: ['Start a session in the block', 'Its minutes go into Deep focus'] },
      { title: 'Keep your habits', steps: ['Tick today', 'The streak counts itself'] },
      { title: 'Then shut down', steps: ['Close every open loop', 'Schedule shutdown, complete'] },
    ],
  },
  tr: {
    label: 'Shutdown Complete nasıl çalışır, beş kısa bölümde',
    scenes: [
      { title: 'Her saate bir plan ver', steps: ['Saatlerin üzerinde sürükle', 'Bloğa adını ver'] },
      { title: 'Gün değişince yeniden çiz', steps: ['Şu andan itibaren revize et', 'Kalan plan sonraki sütuna geçer'] },
      { title: 'Blokta odaklan', steps: ['Blokta bir oturum başlat', 'Dakikaları Derin odağa eklenir'] },
      { title: 'Alışkanlıklarını koru', steps: ['Bugünü işaretle', 'Seri kendini sayar'] },
      { title: 'Sonra günü kapat', steps: ['Bütün açık uçları kapat', 'Kapanış tamamlandı'] },
    ],
  },
};
