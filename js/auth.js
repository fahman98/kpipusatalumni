// --- JS/AUTH.JS ---
// Satu-satunya sumber kebenaran untuk "siapa yang dikira admin".
//
// PENTING: ini gate UI sahaja — ia menentukan apa yang browser PAPARKAN dan
// benarkan pengguna cuba lakukan. Ia BUKAN sempadan keselamatan; sesiapa boleh
// ubah flag client-side dari console. Penguatkuasaan sebenar ada dalam
// firestore.rules, yang menyemak email yang SAMA di sebelah server.
//
// Kalau senarai ini diubah, WAJIB ubah dalam firestore.rules juga (fungsi
// isAdmin()), kalau tidak kedua-duanya jadi tak selari.
//
// alumni@ = akaun unit (kekal supaya unit sentiasa ada akses);
// fahman@ = admin kedua (ditambah 16/11/2026, permintaan pemilik). Setiap
// perubahan dalam Sejarah Perubahan merekod emel yang membuatnya.
export const ADMIN_EMAILS = ['alumni@upsi.edu.my', 'fahman@upsi.edu.my'];

// Adakah `user` ini akaun admin yang dibenarkan?
// Pengguna anonymous (guest) sentiasa false — mereka tiada claim email langsung.
export function isAdminUser(user) {
    if (!user || user.isAnonymous) return false;
    return ADMIN_EMAILS.includes((user.email || '').trim().toLowerCase());
}
