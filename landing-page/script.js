// DriveMate Landing Page Controller — Native App & Tiered License Ready

document.addEventListener('DOMContentLoaded', () => {
  // 1. FAQ Accordion Toggle
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      faqItems.forEach(i => i.classList.remove('active'));
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });

  // Open first FAQ by default
  if (faqItems.length > 0) {
    faqItems[0].classList.add('active');
  }

  // 2. PRO Upgrade Modal Controls & Plan Switching
  const modalPro = document.getElementById('modal-pro');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const openButtons = document.querySelectorAll('.btn-open-pro-modal');

  const planTabs = document.querySelectorAll('.modal-plan-tab');
  const modalPriceStrike = document.querySelector('.modal-price-strike');
  const modalPriceDeal = document.querySelector('.modal-price-deal');
  const modalPriceTag = document.querySelector('.modal-price-tag');
  const modalPayAmount = document.getElementById('modal-pay-amount');
  const qrImage = document.getElementById('modal-qr-img');
  const btnWhatsapp = document.getElementById('btn-modal-whatsapp');

  const PLANS = {
    '6m': {
      priceStrike: '₹499',
      priceDeal: '₹100',
      priceTag: '6 Months • 1 Device Slot',
      qrSrc: 'assets/upi_qr_100.png',
      whatsappHref: 'https://wa.me/918927202527?text=Hi%2C%20I%20have%20paid%20%E2%82%B9100%20for%20DriveMate%206-Month%20Plan%20(1%20Device).%20My%20UPI%20UTR%20is%3A%20',
      whatsappText: '💬 WhatsApp: ₹100 পাঠিয়েছেন (1 Device Key)'
    },
    '1y': {
      priceStrike: '₹1,499',
      priceDeal: '₹500',
      priceTag: '1 Full Year • Up to 5 Devices Simultaneously',
      qrSrc: 'assets/upi_qr_500.png',
      whatsappHref: 'https://wa.me/918927202527?text=Hi%2C%20I%20have%20paid%20%E2%82%B9500%20for%20DriveMate%201-Year%20Team%20Plan%20(5%20Devices).%20My%20UPI%20UTR%20is%3A%20',
      whatsappText: '💬 WhatsApp: ₹500 পাঠিয়েছেন (5 Devices Team Key)'
    }
  };

  function selectPlan(planKey) {
    const config = PLANS[planKey] || PLANS['6m'];
    planTabs.forEach(tab => {
      if (tab.dataset.plan === planKey) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    if (modalPriceStrike) modalPriceStrike.textContent = config.priceStrike;
    if (modalPriceDeal) modalPriceDeal.textContent = config.priceDeal;
    if (modalPriceTag) modalPriceTag.textContent = config.priceTag;
    if (modalPayAmount) modalPayAmount.textContent = config.priceDeal;
    if (qrImage) {
      qrImage.src = config.qrSrc;
      qrImage.alt = `UPI QR Code ${config.priceDeal}`;
    }
    if (btnWhatsapp) {
      btnWhatsapp.href = config.whatsappHref;
      btnWhatsapp.innerHTML = config.whatsappText;
    }
  }

  planTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const plan = tab.dataset.plan;
      selectPlan(plan);
    });
  });

  openButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPlan = btn.dataset.plan || '6m';
      selectPlan(targetPlan);
      if (modalPro) {
        modalPro.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
    });
  });

  function closeModal() {
    if (modalPro) {
      modalPro.style.display = 'none';
      document.body.style.overflow = 'auto';
    }
  }

  btnCloseModal?.addEventListener('click', closeModal);

  modalPro?.addEventListener('click', (e) => {
    if (e.target === modalPro) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalPro?.style.display === 'flex') {
      closeModal();
    }
  });

  // 3. 1-Click Copy UPI ID with Visual Feedback
  const btnCopyUpi = document.getElementById('btn-copy-upi');
  btnCopyUpi?.addEventListener('click', () => {
    const upiId = '8927202527@yapl';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(upiId).then(() => {
        btnCopyUpi.textContent = '✓ Copied!';
        btnCopyUpi.style.background = '#16a34a';
        setTimeout(() => {
          btnCopyUpi.textContent = '📋 Copy';
          btnCopyUpi.style.background = '#0284c7';
        }, 1500);
      }).catch(() => {
        prompt('Copy your UPI ID:', upiId);
      });
    } else {
      prompt('Copy your UPI ID:', upiId);
    }
  });

  // 4. Local File Protocol (file://) Advisory Handler
  const isLocalFile = window.location.protocol === 'file:';
  const modalLocal = document.getElementById('modal-local-file');
  const btnCloseLocal = document.getElementById('btn-close-local-modal');
  const btnCopyPath = document.getElementById('btn-copy-path');
  const localAssetsPathEl = document.getElementById('local-assets-path');
  const btnProceedDownload = document.getElementById('btn-proceed-download-anyway');

  let pendingDownloadUrl = null;

  function closeLocalModal() {
    if (modalLocal) {
      modalLocal.style.display = 'none';
      document.body.style.overflow = 'auto';
    }
  }

  btnCloseLocal?.addEventListener('click', closeLocalModal);
  modalLocal?.addEventListener('click', (e) => {
    if (e.target === modalLocal) closeLocalModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalLocal?.style.display === 'flex') {
      closeLocalModal();
    }
  });

  if (isLocalFile) {
    // Intercept download links when running on file:// to prevent Chrome UUID stripping confusion
    const downloadLinks = document.querySelectorAll('a[download], a[href*="assets/DriveMate"]');
    downloadLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        pendingDownloadUrl = link.getAttribute('href');

        if (localAssetsPathEl) {
          try {
            const currentPath = decodeURIComponent(window.location.pathname);
            const dir = currentPath.substring(0, currentPath.lastIndexOf('/'));
            localAssetsPathEl.textContent = dir + '/assets/';
          } catch (_) {
            localAssetsPathEl.textContent = 'landing-page/assets/';
          }
        }

        if (modalLocal) {
          modalLocal.style.display = 'flex';
          document.body.style.overflow = 'hidden';
        }
      });
    });

    btnProceedDownload?.addEventListener('click', () => {
      if (pendingDownloadUrl) {
        const downloadUrl = pendingDownloadUrl;
        closeLocalModal();
        // Allow the direct file download
        const tempLink = document.createElement('a');
        tempLink.href = downloadUrl;
        tempLink.setAttribute('download', downloadUrl.split('/').pop() || 'DriveMate-Package.zip');
        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);
      }
    });

    btnCopyPath?.addEventListener('click', () => {
      const pathText = localAssetsPathEl?.textContent || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pathText).then(() => {
          btnCopyPath.textContent = '✓ Copied!';
          btnCopyPath.style.background = '#16a34a';
          setTimeout(() => {
            btnCopyPath.textContent = '📋 Copy';
            btnCopyPath.style.background = '#0284c7';
          }, 1500);
        });
      } else {
        prompt('Copy local folder path:', pathText);
      }
    });
  }
});
