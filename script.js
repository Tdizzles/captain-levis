document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.getElementById('nav-toggle');
  const mainNav = document.getElementById('main-nav');
  navToggle?.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  const dots = document.querySelectorAll('.carousel-dots .dot');
  const prev = document.querySelector('.carousel-arrow[aria-label="Previous testimonial"]');
  const next = document.querySelector('.carousel-arrow[aria-label="Next testimonial"]');

  let active = 0;
  const setActive = (i) => {
    active = (i + dots.length) % dots.length;
    dots.forEach((d, idx) => d.classList.toggle('active', idx === active));
  };

  dots.forEach((dot, i) => dot.addEventListener('click', () => setActive(i)));
  prev?.addEventListener('click', () => setActive(active - 1));
  next?.addEventListener('click', () => setActive(active + 1));

  const baRoot = document.getElementById('before-after');
  if (baRoot) {
    const after = baRoot.querySelector('.ba-after');
    const line = baRoot.querySelector('.ba-line');
    const handle = baRoot.querySelector('.ba-handle');
    let dragging = false;

    const setPos = (percent) => {
      percent = Math.min(100, Math.max(0, percent));
      after.style.clipPath = `inset(0 0 0 ${percent}%)`;
      line.style.left = percent + '%';
      handle.style.left = percent + '%';
      baRoot.setAttribute('aria-valuenow', String(Math.round(percent)));
    };

    const percentFromEvent = (e) => {
      const rect = baRoot.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return ((clientX - rect.left) / rect.width) * 100;
    };

    const onDown = (e) => {
      dragging = true;
      setPos(percentFromEvent(e));
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      setPos(percentFromEvent(e));
    };
    const onUp = () => { dragging = false; };

    baRoot.addEventListener('mousedown', onDown);
    baRoot.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    baRoot.addEventListener('keydown', (e) => {
      const current = parseFloat(baRoot.style.getPropertyValue('--ba-pos')) || parseFloat(handle.style.left) || 50;
      if (e.key === 'ArrowLeft') setPos(current - 5);
      if (e.key === 'ArrowRight') setPos(current + 5);
    });

    setPos(50);
  }

  const contactForm = document.getElementById('contact-form');
  contactForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!contactForm.checkValidity()) {
      contactForm.reportValidity();
      return;
    }
    contactForm.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = true);
    contactForm.querySelector('.form-success').hidden = false;
  });

  const chatWidget = document.getElementById('chat-widget');
  const chatToggle = document.getElementById('chat-toggle');
  const chatPanel = document.getElementById('chat-panel');
  const chatClose = document.getElementById('chat-close');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatChips = document.querySelectorAll('.chat-chip');

  if (chatWidget && chatToggle && chatPanel) {
    const openChat = () => {
      chatPanel.hidden = false;
      chatWidget.classList.add('open');
      chatToggle.setAttribute('aria-expanded', 'true');
      chatInput?.focus();
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    const closeChat = () => {
      chatPanel.hidden = true;
      chatWidget.classList.remove('open');
      chatToggle.setAttribute('aria-expanded', 'false');
    };

    chatToggle.addEventListener('click', () => {
      chatPanel.hidden ? openChat() : closeChat();
    });
    chatClose?.addEventListener('click', closeChat);

    const addMessage = (text, from) => {
      const msg = document.createElement('div');
      msg.className = `chat-msg chat-msg-${from}`;
      msg.textContent = text;
      chatMessages.appendChild(msg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    const replyFor = (text) => {
      const q = text.toLowerCase();
      if (/(quote|price|cost|estimate)/.test(q)) {
        return 'Happy to get you a free quote — fill out the form below with a few details about your boat, or call/text 727-391-7639 and we’ll take care of you.';
      }
      if (/(fiberglass)/.test(q)) {
        return 'We repair cracks, blisters and structural fiberglass damage with professional-grade materials. Want a free quote on your repair?';
      }
      if (/(gelcoat|color match|scratch)/.test(q)) {
        return 'Gelcoat repair is one of our specialties — precise color matching for a seamless finish. Send us a photo through the contact form and we’ll take a look.';
      }
      if (/(detail|shine|wax|buff|oxidiz|oxidis)/.test(q)) {
        return 'Our detailing service brings back that showroom shine — wash, buff, wax and oxidation removal. Want a free quote?';
      }
      if (/(restor)/.test(q)) {
        return 'Full restorations are our bread and butter — from oxidized hulls to complete cosmetic overhauls. Tell me a bit about your boat and I’ll point you to the right service.';
      }
      if (/(structural|hull|crack|blister|damage)/.test(q)) {
        return 'Structural fiberglass repairs are done right, with strength and safety front of mind. Fill out the quote form and we’ll assess it properly.';
      }
      if (/(yard|storage|lift|haul)/.test(q)) {
        return 'Our boat yard handles repairs, maintenance and custom work all in one place, right here in Largo, FL.';
      }
      if (/(hour|open|close|time)/.test(q)) {
        return 'We’re open Monday–Saturday, 8:00 AM – 5:00 PM, by appointment or walk-in.';
      }
      if (/(where|location|address|find you)/.test(q)) {
        return 'You’ll find us at 11600 66th St N, Largo, FL 33773 — and we do mobile service around Tampa Bay too.';
      }
      if (/(phone|call|number|text)/.test(q)) {
        return 'Give us a call or text anytime at 727-391-7639 — that’s the fastest way to reach us.';
      }
      if (/(email)/.test(q)) {
        return 'You can reach us at captainlevis@yahoo.com — or use the contact form below.';
      }
      if (/(mobile|come to (me|my dock)|dock)/.test(q)) {
        return 'Yes — we offer mobile service and can come right to your dock for many repairs.';
      }
      if (/(hi|hello|hey|ahoy)/.test(q)) {
        return 'Ahoy there! What can I help you with — fiberglass repair, gelcoat, detailing, or a free quote?';
      }
      if (/(thank)/.test(q)) {
        return 'Anytime! Fair winds — let us know if anything else comes up.';
      }
      return 'Good question — for specifics on that, the best move is to call/text us at 727-391-7639 or fill out the quote form below and we’ll get right back to you.';
    };

    const showTyping = () => {
      const typing = document.createElement('div');
      typing.className = 'chat-msg-typing';
      typing.id = 'chat-typing';
      typing.innerHTML = '<span></span><span></span><span></span>';
      chatMessages.appendChild(typing);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    const hideTyping = () => {
      document.getElementById('chat-typing')?.remove();
    };

    const sendUserText = (text) => {
      text = text.trim();
      if (!text) return;
      addMessage(text, 'user');
      showTyping();
      window.setTimeout(() => {
        hideTyping();
        addMessage(replyFor(text), 'bot');
      }, 550 + Math.random() * 400);
    };

    chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      sendUserText(chatInput.value);
      chatInput.value = '';
    });

    chatChips.forEach((chip) => {
      chip.addEventListener('click', () => sendUserText(chip.dataset.q || chip.textContent));
    });
  }
});
