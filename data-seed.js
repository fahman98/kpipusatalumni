// --- SEED DATA TEMPLATES ---

function getInitialSeedData() {
    const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

    // Base template for all KPIs for Q1
    const q1Template = [
        { id: 'data-alumni', icon: "fa-users", name: "Data Alumni", target: 5000, chartType: 'line', details: { type: 'breakdownList', title: 'Butiran Sumber Data', description: 'Pecahan perolehan data mengikut sumber:', items: [{name: 'Data Awal', value: 898}] } },
        { id: 'kembara', icon: "fa-route", name: "Kembara Santuni Alumni", target: 15, chartType: 'bar', details: { type: 'breakdownList', title: 'Butiran Kembara', description: 'Senarai lokasi yang telah dilawati:', items: [{name: 'Lokasi A', value: 4}] } },
        { id: 'bicara', icon: "fa-microphone-alt", name: "Bicara Alumni", target: 10, chartType: 'bar', details: { type: 'breakdownList', title: 'Butiran Bicara Alumni', description: 'Senarai penceramah yang telah dijemput:', items: [{name: 'Sesi 1', value: 2}] } },
        { id: 'kolaborasi', icon: "fa-handshake", name: "Kolaborasi", target: 4, chartType: 'bar', details: { type: 'list', title: 'Butiran Kolaborasi', description: 'Status pencapaian kolaborasi:', achieved: ['CHN'], targetList: ['CHN', 'Ai Labs', 'Maybank', 'RHB'] } },
        { id: 'pendanaan', icon: "fa-money-bill-wave", name: "Pendanaan & Penjanaan", target: 70000, isCurrency: true, chartType: 'line', details: { type: 'breakdownList', title: 'Butiran Pendanaan', description: 'Senarai penyumbang utama:', items: [{name: 'Sumbangan Awal', value: 4049}] } },
        { id: 'ziarah', icon: "fa-hand-holding-heart", name: "Program Ziarah Kasih", target: 10, chartType: 'bar', details: { type: 'breakdownList', title: 'Butiran Ziarah Kasih', description: 'Senarai ziarah yang telah dilaksanakan:', items: [{name: 'Ziarah A', value: 2}] } },
        { id: 'penerbitan', icon: "fa-book-open", name: "Penerbitan", target: 100, isPercentage: true, chartType: 'line', details: { type: 'progressList', title: 'Butiran Penerbitan', description: 'Pecahan pencapaian bagi komponen penerbitan:', items: [ { name: 'E-pena', value: 20 }, { name: 'Inpirasi Alumni', value: 41.66 }, { name: 'Zero to Hero', value: 15 }, { name: 'Buletin', subItems: [ { name: 'Buletin Alumni', value: 50 }, { name: 'Lensa Alumni', value: 0 } ] }, { name: 'Bicara Ramadan', value: 100 } ] } },
        { id: 'ikon', icon: "fa-star", name: "Ikon AKSB", target: 5, chartType: 'bar', details: { type: 'list', title: 'Butiran Ikon AKSB', description: 'Status penganugerahan Ikon AKSB:', achieved: [], targetList: ['Ikon Inovasi', 'Ikon Pengurusan', 'Ikon Keusahawanan', 'Ikon Sukan', 'Ikon Kesukarelawanan'] } },
        { id: 'chapter', icon: "fa-globe-asia", name: "Chapter Antarabangsa", target: 4, chartType: 'bar', details: { type: 'list', title: 'Butiran Chapter Antarabangsa', description: 'Status penubuhan chapter:', achieved: [], targetList: ['Uzbekistan', 'China', 'Pakistan', 'Oman'] } }
    ];

    // Create Q2 data by cloning Q1 and adding new progress
    const q2Template = deepClone(q1Template);
    q2Template.find(k => k.id === 'data-alumni').details.items.push({name: 'Sumber S2', value: 1208});
    q2Template.find(k => k.id === 'kembara').details.items.push({name: 'Lokasi B', value: 1});
    q2Template.find(k => k.id === 'bicara').details.items.push({name: 'Sesi 2', value: 2});
    const kolaborasiQ2 = q2Template.find(k => k.id === 'kolaborasi');
    kolaborasiQ2.details.achieved.push('Ai Labs', 'Maybank', 'RHB');
    q2Template.find(k => k.id === 'pendanaan').details.items.push({name: 'Sumbangan S2', value: 15758.50});
    q2Template.find(k => k.id === 'ziarah').details.items.push({name: 'Ziarah B', value: 5});
    const penerbitanQ2 = q2Template.find(k => k.id === 'penerbitan');
    penerbitanQ2.details.items.find(i => i.name === 'E-pena').value = 35;
    penerbitanQ2.details.items.find(i => i.name === 'Inpirasi Alumni').value = 50;
    penerbitanQ2.details.items.find(i => i.name === 'Zero to Hero').value = 30;
    penerbitanQ2.details.items.find(i => i.name === 'Buletin').subItems.find(si => si.name === 'Buletin Alumni').value = 0;
    penerbitanQ2.details.items.find(i => i.name === 'Buletin').subItems.find(si => si.name === 'Lensa Alumni').value = 100;
    q2Template.find(k => k.id === 'chapter').details.achieved.push('Uzbekistan');

    // Q3 and Q4 start as a direct continuation of the previous quarter
    const q3Template = deepClone(q2Template);
    const q4Template = deepClone(q3Template);

    return {
        q1: { title: "Suku Pertama", subtitle: "Januari - Mac 2025", footerDate: "1 April 2025, 9:00 AM", placeholder: false, kpis: q1Template },
        q2: { title: "Suku Kedua", subtitle: "April - Jun 2025", footerDate: "1 Julai 2025, 9:00 AM", placeholder: false, kpis: q2Template },
        q3: { title: "Suku Ketiga", subtitle: "Julai - September 2025", footerDate: "1 Oktober 2025", placeholder: false, kpis: q3Template },
        q4: { title: "Suku Keempat", subtitle: "Oktober - Disember 2025", footerDate: "1 Januari 2026", placeholder: false, kpis: q4Template }
    };
}