const express  = require('express');
const router   = express.Router();
const { getDB } = require('../db');

// GET /api/export/package — Returns JSON with products, new categories, and new features CSVs
router.get('/package', (req, res) => {
  const db = getDB();

  const products = db.prepare(
    "SELECT * FROM products WHERE status = 'approved' ORDER BY created_at DESC"
  ).all();

  if (!products.length) {
    return res.status(400).json({ error: 'Aucun produit approuvé à exporter.' });
  }

  // Load reference tables
  const refTables = db.prepare("SELECT table_name, row_data FROM reference_tables WHERE table_name IN ('categories', 'features')").all();
  const refCategoryNames = new Set();
  const refFeatureNames = new Set();
  
  for (const { table_name, row_data } of refTables) {
    try {
      const data = JSON.parse(row_data);
      if (table_name === 'categories' && data.name) refCategoryNames.add(data.name.toLowerCase().trim());
      if (table_name === 'features' && data.name) refFeatureNames.add(data.name.toLowerCase().trim());
    } catch(e) {}
  }

  const usedCategories = new Set();
  const usedFeatures = new Set();

  const HEADERS = [
    'ID', 'Actif (0/1)', 'Nom*', 'Catégories (x,y,z...)', 'Prix HT', 'Prix TTC',
    'ID règle de taxes', 'Prix d\'achat', 'En soldes (0/1)', 'Montant de la remise',
    'Pourcentage de réduction', 'Réduction de (AAAA-MM-JJ)', 'Réduction à (AAAA-MM-JJ)',
    'Référence', 'Référence fournisseur', 'Fournisseurs', 'Marque', 'EAN-13', 'UPC', 'MPN',
    'Éco-participation', 'Largeur', 'Hauteur', 'Profondeur', 'Poids',
    'Délai de livraison pour les produits en stock :',
    'Délai de livraison des produits épuisés avec commande autorisée:',
    'Quantité', 'Quantité minimale', 'Niveau de stock bas',
    'Recevoir une alerte par e-mail lorsque le stock est faible',
    'Visibilité', 'Frais de port supplémentaire', 'Unité pour le prix unitaire', 'Prix unitaire',
    'Récapitulatif', 'Description', 'Mot-clés (x,y,z...)', 'Balise titre', 'Meta mots-clés',
    'Meta description', 'URL réécrite', 'Libellé si en stock', 'Libellé quand précommande activée',
    'Disponible à la commande (0 = Non, 1 = Oui)', 'Date de disponibilité du produit',
    'Date d\'ajout du produit', 'Afficher le prix (0 = Non, 1 = Oui)',
    'URL des images (x,y,z, etc.)', 'Textes alternatif des images (x,y,z...)',
    'Supprimer les images existantes (0 = Non, 1 = Oui)',
    'Caractéristique (Nom:Valeur:Position:Personnalisé)',
    'Disponible en ligne uniquement (0 = Non, 1 = Oui)', 'État',
    'Personnalisable (0 = Non, 1 = Oui)', 'Fichiers téléchargeables (0 = Non, 1 = Oui)',
    'Champs texte (0 = Non, 1 = Oui)', 'Action en cas de rupture de stock',
    'Produit dématérialisé (0 = Non, 1 = Oui)', 'URL du fichier',
    'Nombre de téléchargements autorisés', 'Date d\'expiration (aaaa-mm-jj)',
    'Nombre de jours', 'ID / Nom de la boutique', 'Gestion des stocks avancée',
    'En fonction du stock', 'Entrepôt', 'Accessoires (x,y,z...)'
  ];

  const rows = products.map(p => {
    let allImgsStr = '';
    if (p.selected_image) {
      try {
        const parsed = JSON.parse(p.selected_image);
        if (Array.isArray(parsed)) allImgsStr = parsed.filter(Boolean).join(',');
        else allImgsStr = String(p.selected_image);
      } catch (e) {
        allImgsStr = String(p.selected_image);
      }
    }
    
    const taxId = p.resolved_tax_rule_id ?? 0;
    const catId = p.resolved_category_id ?? '';
    const catName = p.suggested_category || '';
    let catCol = catId ? `${catId}` : catName;

    // Record categories
    try {
      const suggestedCats = JSON.parse(p.suggested_categories || '[]');
      if (Array.isArray(suggestedCats)) {
        suggestedCats.forEach(c => usedCategories.add(c.trim()));
      } else if (catName) {
        usedCategories.add(catName.trim());
      }
    } catch(e) {
      if (catName) usedCategories.add(catName.trim());
    }

    if (p.resolved_category_ids) {
      try {
        const ids = JSON.parse(p.resolved_category_ids);
        if (Array.isArray(ids) && ids.length > 0) catCol = ids.join(',');
      } catch (e) {}
    }

    let featuresStr = '';
    if (p.matched_features) {
      try {
        const mf = JSON.parse(p.matched_features);
        if (Array.isArray(mf)) {
          mf.forEach(f => {
            if(f.name) usedFeatures.add(f.name.trim());
          });
          featuresStr = mf.map((f, i) => `${f.name}:${f.value}:${i + 1}:${f.is_custom !== undefined ? f.is_custom : 1}`).join(',');
        }
      } catch (e) {}
    }
    if (!featuresStr) {
      try {
        const specs = JSON.parse(p.extracted_specs || '{}');
        Object.keys(specs).slice(0, 8).forEach(k => usedFeatures.add(k.trim()));
        featuresStr = Object.entries(specs).slice(0, 8).map(([k, v], i) => `${k}:${v}:${i + 1}:1`).join(',');
      } catch (_) {}
    }

    return [
      '', '1', p.product_title || p.reference, catCol, p.raw_price != null ? p.raw_price.toFixed(6) : '',
      taxId, '', '0', '', '', '', '', p.reference, '', '', p.brand || '', '', '', '', '0', '', '', '', '',
      '', '', '10', '1', '', '0', 'both', '', '', '', p.seo_excerpt || '', p.html_description || '', '',
      p.product_title || p.reference, [p.brand, p.reference].filter(Boolean).join(', '), p.seo_excerpt || '',
      '', 'En Stock', '', '1', '', '', '1', allImgsStr, '', '0', featuresStr, '0', 'new', '0', '0', '0', '2',
      '0', '', '', '', '', '1', '0', '0', '', ''
    ];
  });

  const productsCsv = '\uFEFF' + [HEADERS, ...rows].map(row => row.map(_escapeCell).join(';')).join('\r\n');

  // Compute new categories
  const newCats = [...usedCategories].filter(c => c && !refCategoryNames.has(c.toLowerCase()));
  let newCategoriesCsv = null;
  if (newCats.length > 0) {
    const catHeaders = ['Nom', 'Actif (0/1)'];
    const catRows = newCats.map(c => [c, '1']);
    newCategoriesCsv = '\uFEFF' + [catHeaders, ...catRows].map(row => row.map(_escapeCell).join(';')).join('\r\n');
  }

  // Compute new features
  const newFeats = [...usedFeatures].filter(f => f && !refFeatureNames.has(f.toLowerCase()));
  let newFeaturesCsv = null;
  if (newFeats.length > 0) {
    const featHeaders = ['Nom', 'Position'];
    const featRows = newFeats.map((f, i) => [f, String(i)]);
    newFeaturesCsv = '\uFEFF' + [featHeaders, ...featRows].map(row => row.map(_escapeCell).join(';')).join('\r\n');
  }

  res.json({ productsCsv, newCategoriesCsv, newFeaturesCsv });
});

// GET /api/export/csv — PrestaShop semicolon-delimited import CSV
router.get('/csv', (req, res) => {
  const db = getDB();

  const products = db.prepare(
    "SELECT * FROM products WHERE status = 'approved' ORDER BY created_at DESC"
  ).all();

  if (!products.length) {
    return res.status(400).json({ error: 'Aucun produit approuvé à exporter.' });
  }

  // ── Column headers exactly matching user's PrestaShop import format ─────
  const HEADERS = [
    'ID', 'Actif (0/1)', 'Nom*', 'Catégories (x,y,z...)', 'Prix HT',
    'ID règle de taxes', 'Prix d\'achat', 'En soldes (0/1)', 'Montant de la remise',
    'Pourcentage de réduction', 'Réduction de (AAAA-MM-JJ)', 'Réduction à (AAAA-MM-JJ)',
    'Référence', 'Référence fournisseur', 'Fournisseurs', 'Marque', 'EAN-13', 'UPC', 'MPN',
    'Éco-participation', 'Largeur', 'Hauteur', 'Profondeur', 'Poids',
    'Délai de livraison pour les produits en stock :',
    'Délai de livraison des produits épuisés avec commande autorisée:',
    'Quantité', 'Quantité minimale', 'Niveau de stock bas',
    'Recevoir une alerte par e-mail lorsque le stock est faible',
    'Visibilité', 'Frais de port supplémentaire', 'Unité pour le prix unitaire', 'Prix unitaire',
    'Récapitulatif', 'Description', 'Mot-clés (x,y,z...)', 'Balise titre', 'Meta mots-clés',
    'Meta description', 'URL réécrite', 'Libellé si en stock', 'Libellé quand précommande activée',
    'Disponible à la commande (0 = Non, 1 = Oui)', 'Date de disponibilité du produit',
    'Date d\'ajout du produit', 'Afficher le prix (0 = Non, 1 = Oui)',
    'URL des images (x,y,z, etc.)', 'Textes alternatif des images (x,y,z...)',
    'Supprimer les images existantes (0 = Non, 1 = Oui)',
    'Caractéristique (Nom:Valeur:Position:Personnalisé)',
    'Disponible en ligne uniquement (0 = Non, 1 = Oui)', 'État',
    'Personnalisable (0 = Non, 1 = Oui)', 'Fichiers téléchargeables (0 = Non, 1 = Oui)',
    'Champs texte (0 = Non, 1 = Oui)', 'Action en cas de rupture de stock',
    'Produit dématérialisé (0 = Non, 1 = Oui)', 'URL du fichier',
    'Nombre de téléchargements autorisés', 'Date d\'expiration (aaaa-mm-jj)',
    'Nombre de jours', 'ID / Nom de la boutique', 'Gestion des stocks avancée',
    'En fonction du stock', 'Entrepôt', 'Accessoires (x,y,z...)'
  ];

  const rows = products.map(p => {
    let allImgsStr = '';
    
    // Parse selected_image. It could be a JSON array, a single URL string, or null/empty.
    if (p.selected_image) {
      try {
        const parsed = JSON.parse(p.selected_image);
        if (Array.isArray(parsed)) {
          allImgsStr = parsed.filter(Boolean).join(',');
        } else {
          allImgsStr = String(p.selected_image);
        }
      } catch (e) {
        allImgsStr = String(p.selected_image);
      }
    }
    const taxId   = p.resolved_tax_rule_id ?? 0;
    const catId   = p.resolved_category_id  ?? '';
    const catName = p.suggested_category || '';
    let catCol  = catId ? `${catId}` : catName; // fallback

    if (p.suggested_category) {
      try {
        const names = JSON.parse(p.suggested_category);
        if (Array.isArray(names) && names.length > 0) {
          catCol = names.join(',');
        }
      } catch (e) {
        catCol = p.suggested_category.replace(/[\[\]"']/g, '');
      }
    }

    // Build specs feature string for PrestaShop Features column
    let featuresStr = '';
    if (p.matched_features) {
      try {
        const mf = JSON.parse(p.matched_features);
        if (Array.isArray(mf)) {
          featuresStr = mf
            .map((f, i) => `${String(f.name).replace(/;/g, ',')}:${String(f.value).replace(/[\r\n]+/g, ' ').replace(/;/g, ',')}:${i + 1}:${f.is_custom !== undefined ? f.is_custom : 1}`)
            .join(',');
        }
      } catch (e) {}
    }
    if (!featuresStr) {
      try {
        const specs = JSON.parse(p.extracted_specs || '{}');
        featuresStr = Object.entries(specs)
          .slice(0, 8)
          .map(([k, v], i) => `${k}:${v}:${i + 1}:1`) // default to custom=1 if fallback
          .join(',');
      } catch (_) {}
    }

    // Plain text meta description to avoid HTML tag character limits
    let plainMeta = (p.seo_excerpt || '').replace(/<[^>]+>/g, ' ').replace(/[<>{}=;]/g, '').replace(/\s+/g, ' ').trim();
    if (plainMeta.length > 160) {
      plainMeta = plainMeta.substring(0, 157) + '...';
    }

    return [
      '',           // 1. ID — blank for new products
      '1',          // 2. Actif (0/1)
      p.product_title || p.reference, // 3. Nom*
      catCol,       // 4. Catégories (x,y,z...)
      p.raw_price != null ? p.raw_price.toFixed(6) : '', // 5. Prix HT
      '',           // 6. Prix TTC
      p.resolved_tax_rule_id ? p.resolved_tax_rule_id : '', // 7. ID règle de taxes
      '',           // 8. Prix d'achat
      '0',          // 8. En soldes (0/1)
      '',           // 9. Montant de la remise
      '',           // 10. Pourcentage de réduction
      '',           // 11. Réduction de (AAAA-MM-JJ)
      '',           // 12. Réduction à (AAAA-MM-JJ)
      p.reference,  // 14. Référence
      '',           // 15. Référence fournisseur
      '',           // 16. Fournisseurs
      p.brand || '',// 17. Marque
      '',           // 18. EAN-13
      '',           // 19. UPC
      '',           // 20. MPN
      '0',          // 21. Éco-participation
      '',           // 22. Largeur
      '',           // 23. Hauteur
      '',           // 24. Profondeur
      '',           // 25. Poids
      '',           // 26. Délai de livraison pour les produits en stock
      '',           // 27. Délai de livraison des produits épuisés...
      '10',         // 28. Quantité
      '1',          // 29. Quantité minimale
      '',           // 30. Niveau de stock bas
      '0',          // 31. Recevoir une alerte par e-mail
      'both',       // 32. Visibilité
      '',           // 33. Frais de port supplémentaire
      '',           // 34. Unité pour le prix unitaire
      '',           // 35. Prix unitaire
      plainMeta,    // 36. Récapitulatif (STRICTLY PLAIN TEXT to prevent PrestaShop fallback crash on other languages)
      ((p.seo_excerpt || '') + '<br><br>' + (p.html_description || '')).replace(/[\r\n]+/g, ' ').replace(/;/g, '&#59;'), // 37. Description (Colored bullet points + main desc) NO NEWLINES, NO RAW SEMICOLONS!
      '',           // 38. Mot-clés (x,y,z...)
      (p.meta_title || p.product_title || p.reference).replace(/[<>{}=;]/g, ''), // 39. meta_title
      (p.meta_keywords || [p.brand, p.reference].filter(Boolean).join(', ')).replace(/[<>{}=;]/g, ''), // 40. meta_keywords
      (p.meta_description || plainMeta).replace(/[<>{}=;"']/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(), // 41. meta_description
      '',           // 42. URL réécrite (PS generates automatically)
      'En Stock',   // 43. Libellé si en stock
      '',           // 44. Libellé quand précommande activée
      '1',          // 45. Disponible à la commande (0 = Non, 1 = Oui)
      '',           // 46. Date de disponibilité du produit
      '',           // 47. Date d'ajout du produit
      '1',          // 48. Afficher le prix (0 = Non, 1 = Oui)
      allImgsStr,   // 49. URL des images (x,y,z, etc.)
      '',           // 50. Textes alternatif des images (x,y,z...)
      '0',          // 51. Supprimer les images existantes (0 = Non, 1 = Oui)
      featuresStr,  // 52. Caractéristique (Nom:Valeur:Position:Personnalisé)
      '0',          // 53. Disponible en ligne uniquement (0 = Non, 1 = Oui)
      'new',        // 54. État
      '0',          // 55. Personnalisable (0 = Non, 1 = Oui)
      '0',          // 56. Fichiers téléchargeables (0 = Non, 1 = Oui)
      '0',          // 57. Champs texte (0 = Non, 1 = Oui)
      '2',          // 58. Action en cas de rupture de stock (2 = Refuser les commandes)
      '0',          // 59. Produit dématérialisé (0 = Non, 1 = Oui)
      '',           // 60. URL du fichier
      '',           // 61. Nombre de téléchargements autorisés
      '',           // 62. Date d'expiration (aaaa-mm-jj)
      '',           // 63. Nombre de jours
      '1',          // 64. ID / Nom de la boutique
      '0',          // 65. Gestion des stocks avancée
      '0',          // 66. En fonction du stock
      '',           // 67. Entrepôt
      '',           // 68. Accessoires (x,y,z...)
    ];
  });

  // ── Serialize to semicolon CSV with BOM for Excel ──────────────────────
  const csv = [HEADERS, ...rows]
    .map(row => row.map(_escapeCell).join(';'))
    .join('\r\n');

  const filename = `mediavision_import_${_today()}.csv`;
  res.setHeader('Content-Type',        'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // UTF-8 BOM for Excel compatibility
});

function _escapeCell(val) {
  const s = String(val ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = router;
