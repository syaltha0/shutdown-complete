import nodemailer from 'nodemailer';

// E-mail is optional. With SMTP_URL set (e.g. smtps://user:pass@smtp.example.com:465), the planner verifies new
// addresses and sends password-reset links. Without it, sign-up needs no verification and passwords are reset from
// the server's command line (see server/src/cli.mjs).
const url = process.env.SMTP_URL || '';
const transport = url ? nodemailer.createTransport(url) : null;
const from = process.env.MAIL_FROM || 'Shutdown Complete <no-reply@localhost>';

export const mailEnabled = !!transport;

const T = {
  en: {
    verifySubject: 'Confirm your e-mail for Shutdown Complete',
    verifyBody: (name, link) => `Hello ${name},\n\nConfirm this address to finish setting up your planner:\n${link}\n\nThe link works for 24 hours. If you did not sign up, ignore this e-mail.`,
    resetSubject: 'Reset your Shutdown Complete password',
    resetBody: (name, link) => `Hello ${name},\n\nSomeone asked to reset the password of this account. To choose a new one, open:\n${link}\n\nThe link works for one hour and only once. If it was not you, ignore this e-mail; your password stays as it is.`,
    changedSubject: 'Your Shutdown Complete password was changed',
    changedBody: (name) => `Hello ${name},\n\nThe password of your planner account was just changed, and every other device was signed out.\nIf this was not you, reset your password now and turn on two-step sign-in.`,
    approvedSubject: 'Your Shutdown Complete account is ready',
    approvedBody: (name, link) => `Hello ${name},\n\nThe owner of this planner approved your account. Sign in here:\n${link}`,
    waitingSubject: 'A new account is waiting for your approval',
    waitingBody: (name, who, link) => `Hello ${name},\n\n${who} signed up for your planner and is waiting for your approval.\nApprove or decline it in Settings > Server:\n${link}`,
    inviteSubject: (who) => `${who} invited you to Shutdown Complete`,
    inviteBody: (who, link, days) => `Hello,\n\n${who} invited you to their Shutdown Complete server, a planner for blocking out your workday.\nCreate your account here:\n${link}\n\n${days ? `The link works for ${days} day${days > 1 ? 's' : ''}.` : ''}`,
    requestSubject: (who) => `${who} asks for an invite`,
    requestBody: (name, who, note, link) => `Hello ${name},\n\n${who} would like an account on your planner${note ? `:\n\n  "${note}"` : '.'}\n\nSend an invite or decline in Settings > Server:\n${link}`,
  },
  tr: {
    verifySubject: 'Shutdown Complete için e-postanı doğrula',
    verifyBody: (name, link) => `Merhaba ${name},\n\nPlanlayıcının kurulumunu bitirmek için bu adresi doğrula:\n${link}\n\nBağlantı 24 saat geçerli. Kaydı sen yapmadıysan bu e-postayı yok say.`,
    resetSubject: 'Shutdown Complete şifreni sıfırla',
    resetBody: (name, link) => `Merhaba ${name},\n\nBu hesabın şifresini sıfırlama isteği geldi. Yeni şifre belirlemek için:\n${link}\n\nBağlantı bir saat ve tek kullanımlık geçerli. İstek senden gelmediyse bu e-postayı yok say; şifren değişmez.`,
    changedSubject: 'Shutdown Complete şifren değiştirildi',
    changedBody: (name) => `Merhaba ${name},\n\nPlanlayıcı hesabının şifresi az önce değiştirildi ve diğer bütün cihazlardan çıkış yapıldı.\nBunu sen yapmadıysan hemen şifreni sıfırla ve iki adımlı girişi aç.`,
    approvedSubject: 'Shutdown Complete hesabın hazır',
    approvedBody: (name, link) => `Merhaba ${name},\n\nBu planlayıcının sahibi hesabını onayladı. Buradan giriş yapabilirsin:\n${link}`,
    waitingSubject: 'Onayını bekleyen yeni bir hesap var',
    waitingBody: (name, who, link) => `Merhaba ${name},\n\n${who} planlayıcına kayıt oldu ve onayını bekliyor.\nAyarlar > Sunucu'dan onaylayabilir ya da reddedebilirsin:\n${link}`,
    inviteSubject: (who) => `${who} seni Shutdown Complete'e davet etti`,
    inviteBody: (who, link, days) => `Merhaba,\n\n${who} seni kendi Shutdown Complete sunucusuna davet etti; iş gününü bloklara bölerek planladığın bir planlayıcı.\nHesabını buradan oluştur:\n${link}\n\n${days ? `Bağlantı ${days} gün geçerli.` : ''}`,
    requestSubject: (who) => `${who} davet istiyor`,
    requestBody: (name, who, note, link) => `Merhaba ${name},\n\n${who} planlayıcında bir hesap istiyor${note ? `:\n\n  "${note}"` : '.'}\n\nAyarlar > Sunucu'dan davet gönderebilir ya da reddedebilirsin:\n${link}`,
  },
};

async function send(to, subject, text) {
  if (!transport) return false;
  try {
    await transport.sendMail({ from, to, subject, text });
    return true;
  } catch (e) {
    console.error('[mail] could not send:', e.message);
    return false;
  }
}

const t = (lang) => T[lang] || T.en;
/** Any message (the weekly review). */
export const sendMail = (to, subject, text) => send(to, subject, text);
export const sendVerify = (u, link) => send(u.email, t(u.lang).verifySubject, t(u.lang).verifyBody(u.name, link));
export const sendReset = (u, link) => send(u.email, t(u.lang).resetSubject, t(u.lang).resetBody(u.name, link));
export const sendPasswordChanged = (u) => send(u.email, t(u.lang).changedSubject, t(u.lang).changedBody(u.name));
export const sendApproved = (u, link) => send(u.email, t(u.lang).approvedSubject, t(u.lang).approvedBody(u.name, link));
export const sendInvite = (to, lang, who, link, days) => send(to, t(lang).inviteSubject(who), t(lang).inviteBody(who, link, days));
export const sendRequest = (admin, who, note, link) => send(admin.email, t(admin.lang).requestSubject(who), t(admin.lang).requestBody(admin.name, who, note, link));
export const sendWaiting = (admin, who, link) => send(admin.email, t(admin.lang).waitingSubject, t(admin.lang).waitingBody(admin.name, who, link));
