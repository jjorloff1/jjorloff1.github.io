// js/time.js
(function () {
  function pad2(n) { return String(n).padStart(2, '0'); }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function ymd(d) {
    const x = new Date(d);
    const y = x.getFullYear();
    const m = pad2(x.getMonth() + 1);
    const day = pad2(x.getDate());
    return `${y}-${m}-${day}`;
  }

  // ISO week start (Monday)
  function startOfISOWeek(d) {
    const x = startOfDay(d);
    const day = x.getDay(); // 0 Sun .. 6 Sat
    const diff = (day === 0 ? -6 : 1 - day); // move to Monday
    x.setDate(x.getDate() + diff);
    return x;
  }

  function secondsToHMS(totalSeconds) {
    const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return `${h}:${pad2(m)}:${pad2(r)}`;
  }

  function secondsToHM(totalSeconds) {
    const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${pad2(m)}`;
  }

  function secondsToMSS(totalSeconds) {
    const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${pad2(r)}`;
  }

  window.Time = {
    pad2,
    startOfDay,
    ymd,
    startOfISOWeek,
    secondsToHMS,
    secondsToHM,
    secondsToMSS
  };
})();