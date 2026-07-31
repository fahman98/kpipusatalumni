// --- JS/AUTH.JS ---
// Satu-satunya sumber kebenaran untuk "siapa yang dikira admin".
//
// PENTING: ini gate UI sahaja — ia menentukan apa yang browser PAPARKAN dan
// benarkan pengguna cuba lakukan. Ia BUKAN sempadan keselamatan; sesiapa boleh
// ubah flag client-side dari console. Penguatkuasaan sebenar ada dalam
// firestore.rules, yang menyemak email yang SAMA di sebelah server.
//
// Kalau email admin ditukar di sini, WAJIB tukar dalam firestore.rules juga
// (fungsi isAdmin()) — kalau tidak kedua-duanya jadi tak selari.

export const ADMIN_EMAIL = 'alumni@upsi.edu.my';

// Adakah `user` ini akaun admin yang dibenarkan?
// Pengguna anonymous (guest) sentiasa false — mereka tiada claim email langsung.
export function isAdminUser(user) {
    if (!user || user.isAnonymous) return false;
    return (user.email || '').trim().toLowerCase() === ADMIN_EMAIL;
}
