// DriveMate Landing Page Controller — Lightweight Vanilla JS

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

  // 2. PRO Upgrade Modal Controls
  const modalPro = document.getElementById('modal-pro');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const openButtons = document.querySelectorAll('.btn-open-pro-modal');

  openButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
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
});
