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

// Semakan aset (tab Aset): akaun yang boleh membaca dan menulis data aset.
// Ini peranan berasingan daripada admin: farhiah@ hanya nampak dashboard
// seperti orang awam ditambah tab Aset, dan tidak boleh mengubah data KPI.
// Mesti selari dengan fungsi isAset() dalam firestore.rules. Akaun baharu
// mesti DICIPTA dalam Firebase Authentication SEBELUM rules yang menamakannya
// diterbitkan, kalau tidak sesiapa boleh mendaftar dengan emel itu.
export const ASET_EMAILS = ['alumni@upsi.edu.my', 'fahman@upsi.edu.my', 'farhiah@upsi.edu.my'];

export function isAsetUser(user) {
    if (!user || user.isAnonymous) return false;
    return ASET_EMAILS.includes((user.email || '').trim().toLowerCase());
}

// Boleh log masuk langsung? (admin, atau pengguna aset sahaja)
export function canSignIn(user) {
    return isAdminUser(user) || isAsetUser(user);
}
