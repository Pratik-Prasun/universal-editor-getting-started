/*
  Survey block for AEM Edge Delivery Services.
  Radios, sliders, and read-only "fact" slides.
  Builds DOM nodes, tracks progress, supports grouped questions.
*/

// Import faintly for template rendering
import { renderBlock } from '../../scripts/faintly.js';

// Constants used across the survey
const SURVEY_CONSTANTS = {
  MANDATORY_TRUE: 'TRUE',
  QUESTION_TYPE: 'question',
  FACT_TYPE: 'fact',
  SLIDER_TYPE: 'slider',
  RADIO_TYPE: 'radio',
};

// Destructure for cleaner access
const {
  MANDATORY_TRUE, QUESTION_TYPE, FACT_TYPE, SLIDER_TYPE, RADIO_TYPE,
} = SURVEY_CONSTANTS;

// Required only if mandatory and it's an actual question (facts don't count)
function isAnswerRequired(question) {
  return (
    question.Mandatory === MANDATORY_TRUE
    && question.ContentType === QUESTION_TYPE
  );
}

// Null/undefined means unanswered; empty string may be valid for some types
function hasValidAnswer(question, answers) {
  return answers[question.ContentId] != null;
}

// Extract base ID from question ID (removes letter suffix like 'a', 'b', 'c')
function getBaseId(contentId) {
  return contentId.replace(/[a-z]$/, '');
}

// Check if question is part of a group (has letter suffix)
function isGroupedQuestion(contentId) {
  return getBaseId(contentId) !== contentId;
}

// Find all related questions starting from a given index (q5a, q5b, q5c, etc.)
function findRelatedQuestions(surveyData, startIndex) {
  const relatedQuestions = [surveyData[startIndex]];
  const baseId = getBaseId(surveyData[startIndex].ContentId);

  // Only consider it a group if the base ID is different from the original (has letter suffix)
  if (baseId === surveyData[startIndex].ContentId) {
    return relatedQuestions; // Single question, no related ones
  }

  // Look for subsequent questions with the same base ID
  for (let i = startIndex + 1; i < surveyData.length; i += 1) {
    const currentQuestion = surveyData[i];
    const currentBaseId = getBaseId(currentQuestion.ContentId);

    if (
      currentBaseId === baseId
      && currentBaseId !== currentQuestion.ContentId
    ) {
      relatedQuestions.push(currentQuestion);
    } else {
      break; // Stop when we find a question that doesn't belong to this group
    }
  }

  return relatedQuestions;
}

// DOM element helper
function createElement(tag, className = '', textContent = '', attributes = {}) {
  const element = document.createElement(tag);
  if (className) element.classList.add(...className.split(' '));
  if (textContent) element.textContent = textContent;

  Object.entries(attributes).forEach(([key, value]) => {
    if (key.startsWith('data-')) {
      element.dataset[key.replace('data-', '')] = value;
    } else {
      element.setAttribute(key, value);
    }
  });

  return element;
}

// Move node to target parent and add class
function moveNode(node, targetParent, className) {
  if (node) {
    node.classList?.add(className);
    if (targetParent && node.parentElement !== targetParent) {
      targetParent.appendChild(node);
    }
  }
}

// Attach the same listener to multiple elements
function attachListeners(elements, eventType, handler) {
  elements.forEach(
    (element) => element && element.addEventListener(eventType, handler),
  );
}

// Replace container content
function replaceContent(container, newContent) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (typeof newContent === 'string') {
    container.textContent = newContent;
  } else if (newContent) {
    container.appendChild(newContent);
  }
}

// Fetch survey JSON; supports pretty hrefs via /paths.json
async function fetchSurveyData(surveyHref) {
  let mapping = surveyHref;
  if (!surveyHref.endsWith('json')) {
    const mappingresp = await fetch('/paths.json');
    const mappingData = await mappingresp.json();
    const mappingEntries = Object.entries(mappingData.mappings);
    const foundMapping = mappingEntries.find(([, value]) => {
      const [before] = value.split(':');
      return before === surveyHref;
    });
    if (foundMapping) {
      const [, after] = foundMapping[1].split(':');
      mapping = after;
    }
  }
  const resp = await fetch(mapping);
  const json = await resp.json();
  return json;
}

// Normalize API payload (Options can be CSV)
function parseSurveyData(surveyResponse) {
  return (surveyResponse.data || [])
    .map((item) => {
      if (item.Options && typeof item.Options === 'string') {
        item.Options = item.Options.split(',').map((opt) => opt.trim());
      }
      return item;
    })
    .sort((a, b) => parseInt(a.Order, 10) - parseInt(b.Order, 10));
}

// Compute progress over counted questions
function calculateProgress(currentIndex, surveyData) {
  const totalActualQuestions = surveyData.filter(
    (q) => q.CountsAsQuestion === 'TRUE',
  ).length;
  const questionsCompleted = surveyData
    .slice(0, currentIndex + 1)
    .filter((q) => q.CountsAsQuestion === 'TRUE').length;

  const progress = (questionsCompleted / totalActualQuestions) * 100;
  return { progress, questionsCompleted, totalActualQuestions };
}

// Create template containers
async function createTemplateContainer(templateName, templateData) {
  const container = document.createElement('div');
  container.dataset.blockName = 'survey';

  await renderBlock(container, {
    blockName: 'survey',
    template: { name: templateName },
    codeBasePath: window.hlx ? window.hlx.codeBasePath : '',
    ...templateData,
  });

  return container.firstElementChild;
}

// Create fact content template
async function createFactContentTemplate(title, question) {
  return createTemplateContainer('fact-content', { title, question });
}

// Create radio options template
async function createRadioOptionsTemplate(contentId, options) {
  // Add IDs to options
  const processedOptions = options.map((option) => ({
    text: option,
    value: option,
    id: `${contentId}-${option.replace(/\s+/g, '-').toLowerCase()}`,
  }));

  return createTemplateContainer('radio-options', {
    contentId,
    options: processedOptions,
  });
}

// Create button container template
async function createButtonContainerTemplate(buttonContent) {
  return createTemplateContainer('button-container', { buttonContent });
}

// Create survey area wrapper template
async function createSurveyAreaWrapperTemplate() {
  return createTemplateContainer('survey-area-wrapper', {});
}

// Create slider template
async function createSliderTemplate(contentId, options, questionText = '') {
  return createTemplateContainer('slider', {
    contentId,
    options,
    questionText,
    optionsLength: String(options.length - 1),
    optionsJson: JSON.stringify(options),
  });
}

// Create question content template
async function createQuestionContentTemplate(
  title,
  question,
  hasMultipleQuestions,
  optionType,
  contentId,
  options,
  relatedQuestions,
) {
  // Determine if question text should be shown
  const shouldShowQuestionText = !(
    hasMultipleQuestions && optionType === SLIDER_TYPE
  );

  // Create options content based on type
  let optionsContent;
  if (optionType === RADIO_TYPE) {
    // Use radio options template
    optionsContent = await createRadioOptionsTemplate(contentId, options);
  } else if (optionType === SLIDER_TYPE) {
    // Create options container with sliders
    const optionsDiv = document.createElement('div');
    optionsDiv.classList.add('options');

    if (hasMultipleQuestions) {
      // Multiple sliders for grouped questions
      const sliderPromises = relatedQuestions.map((relatedQuestion) => createSliderTemplate(
        relatedQuestion.ContentId,
        relatedQuestion.Options,
        relatedQuestion.Question,
      ));
      const sliders = await Promise.all(sliderPromises);
      sliders.forEach((slider) => {
        optionsDiv.appendChild(slider);
      });
    } else {
      // Single slider
      const slider = await createSliderTemplate(contentId, options);
      optionsDiv.appendChild(slider);
    }

    optionsContent = optionsDiv;
  }

  // Use question content template
  return createTemplateContainer('question-content', {
    title,
    question,
    shouldShowQuestionText,
    optionsContent,
  });
}

// Create summary container template
async function createSummaryContainerTemplate(header, answersList) {
  return createTemplateContainer('summary-container', { header, answersList });
}

// Create main survey template
async function createMainSurveyTemplate(
  progress,
  questionsCompleted,
  totalActualQuestions,
  section,
  icon,
  contentElement,
) {
  const isComplete = progress >= 100;
  return createTemplateContainer('main', {
    progress,
    questionsCompleted,
    totalActualQuestions,
    isComplete,
    section,
    icon,
    contentElement,
  });
}

// Common props + progress
function getQuestionContext(questionData, currentIndex, surveyData) {
  const { Section, Icon } = questionData;
  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );
  return {
    Section,
    Icon,
    progress,
    questionsCompleted,
    totalActualQuestions,
  };
}

// Fact slide
async function createFactContent(questionData, currentIndex, surveyData) {
  const { Title, Question } = questionData;
  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

  // Use fact content template function
  const contentElement = await createFactContentTemplate(Title, Question);

  return createMainSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Interactive slide (radio/slider, supports grouped sliders)
async function createQuestion(questionData, currentIndex, surveyData) {
  const {
    ContentType, Title, Question, Options, OptionType, ContentId,
  } = questionData;

  if (ContentType === FACT_TYPE) {
    return createFactContent(questionData, currentIndex, surveyData);
  }

  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

  // Find all related questions (q5a, q5b, q5c, etc.)
  const relatedQuestions = findRelatedQuestions(surveyData, currentIndex);
  const hasMultipleQuestions = relatedQuestions.length > 1;

  // Use question content template
  const contentElement = await createQuestionContentTemplate(
    Title,
    Question,
    hasMultipleQuestions,
    OptionType,
    ContentId,
    Options,
    relatedQuestions,
  );

  return createMainSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Format answer using AnswerTemplate
function formatAnswerFromTemplate(question, selectedAnswer) {
  let template = question.AnswerTemplate;

  // Skip if no template available
  if (!template || template === 'N/A') {
    return `You selected: <strong>${selectedAnswer || '—'}</strong>.`;
  }

  // Basic answer replacement
  template = template.replace('{answer}', selectedAnswer);

  // Handle "None" -> "no" for Q5 questions
  if (template.includes('{answer_none_fix}')) {
    const value = selectedAnswer === 'None' ? 'no' : selectedAnswer.toLowerCase();
    template = template.replace('{answer_none_fix}', value);
  }

  // Handle Q4 and Q6 modifiers
  if (template.includes('{answer_modifier}')) {
    const modifiers = {
      q4: { Yes: '', No: ' not' },
      q6: { Yes: 'have', No: "haven't" },
    };
    const modifier = modifiers[question.ContentId]?.[selectedAnswer] || '';
    template = template.replace('{answer_modifier}', modifier);
  }

  // Handle Q6 "yet" suffix
  if (template.includes('{yet_modifier}')) {
    const yet = question.ContentId === 'q6' && selectedAnswer === 'No' ? ' yet' : '';
    template = template.replace('{yet_modifier}', yet);
  }

  return template;
}

// Group related questions for answer display (q5a, q5b -> single card)
function groupQuestionsForAnswers(surveyData, surveyAnswers) {
  // First get all questions (both counted and uncounted) to find groups
  const allQuestions = surveyData.filter(
    (q) => q.ContentType === QUESTION_TYPE,
  );

  const groups = [];
  let i = 0;

  while (i < allQuestions.length) {
    const currentQuestion = allQuestions[i];
    const baseId = getBaseId(currentQuestion.ContentId);

    // Check if this is part of a group (has letter suffix)
    if (isGroupedQuestion(currentQuestion.ContentId)) {
      // Find all related questions in the group
      const group = [currentQuestion];
      let j = i + 1;

      while (j < allQuestions.length) {
        const nextQuestion = allQuestions[j];
        const nextBaseId = getBaseId(nextQuestion.ContentId);

        if (
          nextBaseId === baseId
          && isGroupedQuestion(nextQuestion.ContentId)
        ) {
          group.push(nextQuestion);
          j += 1;
        } else {
          break;
        }
      }

      // Only include groups that have at least one counted question and have answers
      const hasCountedQuestion = group.some(
        (q) => q.CountsAsQuestion === 'TRUE',
      );
      const hasAnswers = group.some((q) => surveyAnswers[q.ContentId] != null);

      if (hasCountedQuestion && hasAnswers) {
        groups.push(group);
      }
      i = j; // Skip the grouped questions
    } else {
      // Single question - only include if counted and has answer
      if (
        currentQuestion.CountsAsQuestion === 'TRUE'
        && surveyAnswers[currentQuestion.ContentId] != null
      ) {
        groups.push([currentQuestion]);
      }
      i += 1;
    }
  }

  return groups;
}

// Create footer container template
async function createFooterContainerTemplate(
  authoredContent,
  thankYouMessage,
  saveButton,
  learnMoreParagraph,
) {
  return createTemplateContainer('footer-container', {
    authoredContent,
    thankYouMessage,
    saveButton,
    learnMoreParagraph,
  });
}

// Create answer cards template
async function createAnswerCardsTemplate(surveyData, surveyAnswers) {
  const questionGroups = groupQuestionsForAnswers(surveyData, surveyAnswers);
  const total = questionGroups.length;

  // Process groups for template
  const processedGroups = questionGroups.map((group, index) => {
    const firstQuestion = group[0];

    // Create formatted answers container
    const answersContainer = document.createElement('div');
    group.forEach((q) => {
      const answerValue = surveyAnswers[q.ContentId];
      const formattedAnswer = formatAnswerFromTemplate(q, answerValue);
      const sentenceDiv = document.createElement('div');

      // Handle known safe HTML patterns or fallback to text
      if (
        formattedAnswer.includes('<strong>')
        && formattedAnswer.includes('</strong>')
      ) {
        // Parse <strong> tags
        const parts = formattedAnswer.split('<strong>');
        parts.forEach((part, partIndex) => {
          if (partIndex === 0) {
            if (part) sentenceDiv.appendChild(document.createTextNode(part));
          } else {
            const [strongText, afterStrong] = part.split('</strong>');
            if (strongText) {
              const strongEl = createElement('strong', '', strongText);
              sentenceDiv.appendChild(strongEl);
            }
            if (afterStrong) {
              sentenceDiv.appendChild(document.createTextNode(afterStrong));
            }
          }
        });
      } else {
        // No HTML tags, use as plain text
        sentenceDiv.textContent = formattedAnswer;
      }

      answersContainer.appendChild(sentenceDiv);
    });

    return {
      section: firstQuestion.Section || '',
      answerNumber: index + 1,
      total,
      slideNumber: index + 1,
      icon: firstQuestion.Icon || '💡',
      formattedAnswers: answersContainer,
    };
  });

  return createTemplateContainer('answer-cards', {
    questionGroups: processedGroups,
  });
}

export default async function decorate(block) {
  if (!block) return;

  // Don't decorate twice
  if (block.dataset.decorated === '1') return;
  block.dataset.decorated = '1';

  let surveyArea = block.querySelector(':scope > div:nth-child(1)');
  const logo = block.querySelector(':scope > div:nth-child(2)');
  const content = block.querySelector(':scope > div:nth-child(3)');
  const footer = block.querySelector(':scope > div:last-child');

  // Ensure survey-area wrapper exists using template
  if (!surveyArea && (logo || content)) {
    const surveyAreaWrapper = await createSurveyAreaWrapperTemplate();
    block.prepend(surveyAreaWrapper);
    surveyArea = surveyAreaWrapper;
  } else if (surveyArea) {
    // Add the class if survey area already exists
    surveyArea.classList.add('survey-area');
  }

  // Add footer class for later querySelector
  footer?.classList.add('footer-content');

  // Promote first picture to background-image
  const bgWrapper = surveyArea?.querySelector(':scope > div:first-child');
  const pic = bgWrapper?.querySelector('picture');
  const img = pic?.querySelector('img');

  if (pic && img && surveyArea) {
    const applyBackgroundAndRemove = () => {
      if (img.currentSrc) {
        surveyArea.style.backgroundImage = `url(${img.currentSrc})`;
        surveyArea?.classList.add('has-background');
      }
      if (bgWrapper && bgWrapper.parentElement) {
        bgWrapper.parentElement.removeChild(bgWrapper);
      } else if (pic.parentElement) {
        pic.parentElement.removeChild(pic);
      }
    };

    if (img.currentSrc) {
      img
        .decode()
        .then(applyBackgroundAndRemove)
        .catch(applyBackgroundAndRemove);
    } else {
      img.addEventListener(
        'load',
        () => {
          img
            .decode()
            .then(applyBackgroundAndRemove)
            .catch(applyBackgroundAndRemove);
        },
        { once: true },
      );
    }
  }

  moveNode(logo, surveyArea, 'logo');
  moveNode(content, surveyArea, 'content');

  // Replace <p> button container with properly structured <div> using template
  const buttonContainer = block.querySelector('p.button-container');
  if (buttonContainer) {
    // Extract the button content
    const buttonContent = buttonContainer.cloneNode(true);
    buttonContent.classList.remove('button-container'); // Remove the class since template will add it

    // Create new button container using template
    const newButtonContainer = await createButtonContainerTemplate(buttonContent);

    // Replace the old container with the new one
    buttonContainer.parentNode.replaceChild(newButtonContainer, buttonContainer);
  }

  // Survey state
  let surveyData = [];
  let currentQuestionIndex = 0;
  let surveyAnswers = {};
  let originalContent = '';

  // Input handlers and validation
  // Slider change handler
  function handleSliderInput(e, options, questionId) {
    const selectedIndex = parseInt(e.target.value, 10);
    surveyAnswers[questionId] = options[selectedIndex];

    // Update selected-* classes
    const trackWrapper = e.target.parentElement;

    // Remove all previous selection classes
    for (let i = 0; i < options.length; i += 1) {
      trackWrapper.classList.remove(`selected-${i}`);
    }

    // Add the current selection class
    trackWrapper.classList.add(`selected-${selectedIndex}`);
  }

  // Radio change handler
  function handleRadioChange(e, questionId) {
    surveyAnswers[questionId] = e.target.value;
  }

  // Highlight invalid controls
  function addErrorState(question) {
    const currentQuestion = surveyData[currentQuestionIndex];

    if (currentQuestion.OptionType === RADIO_TYPE) {
      // For radio buttons, find all options for this question
      const options = surveyArea.querySelectorAll(
        `input[name="${question.ContentId}"]`,
      );
      options.forEach((option) => {
        const optionDiv = option.closest('.option');
        if (optionDiv) {
          optionDiv.classList.add('error');
        }
      });
    } else if (currentQuestion.OptionType === SLIDER_TYPE) {
      // For sliders, find the specific slider track wrapper
      const slider = surveyArea.querySelector(
        `input[name="${question.ContentId}"]`,
      );
      if (slider) {
        const trackWrapper = slider.closest('.slider-track-wrapper');
        if (trackWrapper) {
          trackWrapper.classList.add('error');
        }
      }
    }
  }

  // Clear all error states
  function clearErrorStates() {
    surveyArea
      .querySelectorAll('.option.error, .slider-track-wrapper.error')
      .forEach((element) => element.classList.remove('error'));
  }

  // Validate current slide
  function validateQuestions(relatedQuestions) {
    const invalidQuestions = relatedQuestions.filter((question) => {
      const isRequired = isAnswerRequired(question);
      const hasAnswer = hasValidAnswer(question, surveyAnswers);
      return isRequired && !hasAnswer;
    });

    // Always clear previous error states first
    clearErrorStates();

    if (invalidQuestions.length > 0) {
      // Add error visual feedback to invalid questions
      invalidQuestions.forEach(addErrorState);
      return false;
    }

    return true;
  }

  // Wire inputs for the current slide
  function attachInputListeners() {
    const currentQuestion = surveyData[currentQuestionIndex];
    const relatedQuestions = findRelatedQuestions(
      surveyData,
      currentQuestionIndex,
    );

    if (currentQuestion.OptionType === SLIDER_TYPE) {
      const sliders = surveyArea.querySelectorAll('.slider');

      sliders.forEach((slider, index) => {
        const trackWrapper = slider.parentElement;
        const questionData = relatedQuestions[index];
        const options = JSON.parse(slider.dataset.options);

        // Listen for changes
        slider.addEventListener('input', (e) => {
          handleSliderInput(e, options, questionData.ContentId);
        });

        // Initialize values and CSS classes
        if (surveyAnswers[questionData.ContentId]) {
          const answerIndex = options.indexOf(
            surveyAnswers[questionData.ContentId],
          );
          if (answerIndex !== -1) {
            slider.value = answerIndex;
            // Add selected class for previously made selection
            trackWrapper.classList.add(`selected-${answerIndex}`);
          }
        } else {
          const defaultIndex = parseInt(slider.value, 10);
          surveyAnswers[questionData.ContentId] = options[defaultIndex];
          // Add selected class for default value too since slider shows it as selected
          trackWrapper.classList.add(`selected-${defaultIndex}`);
        }
      });
    } else if (currentQuestion.OptionType === RADIO_TYPE) {
      const radioButtons = surveyArea.querySelectorAll(
        `input[name="${currentQuestion.ContentId}"]`,
      );

      attachListeners(radioButtons, 'change', (e) => handleRadioChange(e, currentQuestion.ContentId));

      // Restore previous answers
      radioButtons.forEach((radio) => {
        radio.checked = surveyAnswers[currentQuestion.ContentId] === radio.value;
      });
    }
  }

  // Navigation handler
  function handleNavigation(direction) {
    if (direction === 'next') {
      const relatedQuestions = findRelatedQuestions(
        surveyData,
        currentQuestionIndex,
      );

      if (!validateQuestions(relatedQuestions)) {
        return;
      }
    }

    // Emit custom event
    surveyArea.dispatchEvent(new CustomEvent(`survey:${direction}`));
  }

  // Bind nav buttons
  function attachNavigationListeners() {
    const backBtn = surveyArea.querySelector('.btn-back');
    const nextBtn = surveyArea.querySelector('.btn-next');
    if (backBtn) backBtn.addEventListener('click', () => handleNavigation('back'));
    if (nextBtn) nextBtn.addEventListener('click', () => handleNavigation('next'));
  }

  // Render a question slide and bind listeners
  async function showQuestion(index) {
    currentQuestionIndex = index;
    const questionData = surveyData[index];

    const questionElement = await createQuestion(
      questionData,
      index,
      surveyData,
    );
    // Keep container class
    surveyArea.className = 'survey-area';
    replaceContent(surveyArea, questionElement);

    attachNavigationListeners();
    attachInputListeners();
  }

  // Start survey on click
  async function handleGetStartedClick(e) {
    e.preventDefault();

    const surveyDataPath = e.target.getAttribute('href');

    try {
      // Store original content for restoration
      originalContent = surveyArea.innerHTML;

      // Fetch + normalize survey data
      const data = await fetchSurveyData(surveyDataPath);
      // Normalize/parse data shape
      surveyData = parseSurveyData(data);

      // Start survey
      currentQuestionIndex = 0;
      surveyAnswers = {};
      await showQuestion(0);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load survey data:', error);
    }
  }

  // Wire up the Get Started button
  function attachGetStartedListener() {
    const getStartedButton = surveyArea.querySelector(
      '.button-container .button',
    );
    attachListeners([getStartedButton], 'click', handleGetStartedClick);
  }

  // Find the first item in a grouped set
  function findGroupStart(startIndex) {
    let index = startIndex;
    const targetQuestion = surveyData[index];
    const targetBaseId = getBaseId(targetQuestion.ContentId);

    // If not a grouped question, return as-is
    if (!isGroupedQuestion(targetQuestion.ContentId)) {
      return index;
    }

    // Find the first question in the group
    while (index > 0) {
      const prevQ = surveyData[index - 1];
      const prevBaseId = getBaseId(prevQ.ContentId);

      if (prevBaseId === targetBaseId && isGroupedQuestion(prevQ.ContentId)) {
        index -= 1;
      } else {
        break;
      }
    }

    return index;
  }

  // Jump past grouped siblings to the next question
  function getNextQuestionIndex() {
    const relatedQuestions = findRelatedQuestions(
      surveyData,
      currentQuestionIndex,
    );
    const questionsToSkip = relatedQuestions.length - 1;
    return currentQuestionIndex + 1 + questionsToSkip;
  }

  // Survey navigation event handlers
  if (surveyArea) {
    // Handle back navigation
    surveyArea.addEventListener('survey:back', async () => {
      if (currentQuestionIndex === 0) {
        // Go back to original content
        replaceContent(surveyArea);
        surveyArea.innerHTML = originalContent;
        attachGetStartedListener();
      } else {
        const prevIndex = findGroupStart(currentQuestionIndex - 1);
        await showQuestion(prevIndex);
      }
    });

    // Handle next/forward navigation
    surveyArea.addEventListener('survey:next', async () => {
      const nextIndex = getNextQuestionIndex();

      if (nextIndex < surveyData.length) {
        await showQuestion(nextIndex);
      } else {
        // Done: show summary
        // Swap content for answers summary (UL/LI)
        const contentDiv = surveyArea.querySelector('.content');
        if (contentDiv) {
          // Create header
          const header = await createTemplateContainer(
            'answer-summary-header',
            {},
          );

          // Build answers list
          const listEl = await createAnswerCardsTemplate(
            surveyData,
            surveyAnswers,
          );

          // Create summary container
          const container = await createSummaryContainerTemplate(
            header,
            listEl,
          );
          replaceContent(contentDiv, container);
        }

        // Show footer after completion: thanks + save + learn more
        const footerDiv = block.querySelector('.footer-content');
        if (footerDiv) {
          // Modal setup function
          const buildSaveAnswersModal = async () => {
            // Avoid duplicate overlays
            let overlay = document.querySelector('.survey-modal-overlay');
            if (overlay) return overlay;

            // Create modal from template
            overlay = await createTemplateContainer('save-modal', {});
            document.body.appendChild(overlay);

            // Get elements from template
            const closeBtn = overlay.querySelector('.survey-modal-close');
            const emailBtn = overlay.querySelector('[data-action="email-answers"]');
            const pdfBtn = overlay.querySelector('[data-action="download-pdf"]');

            // Focus handling
            function closeModal() {
              overlay.classList.add('hidden');
              document.body.classList.remove('survey-modal-open');
              const saveButton = document.getElementById('save-answers');
              if (saveButton) saveButton.focus();
            }

            closeBtn.addEventListener('click', closeModal);
            overlay.addEventListener('click', (e) => {
              if (e.target === overlay) closeModal();
            });
            document.addEventListener('keydown', (e) => {
              if (!overlay.classList.contains('hidden') && e.key === 'Escape') {
                closeModal();
              }
            });

            // TODO: integrate email and PDF functionality
            emailBtn.addEventListener('click', () => {
              // TODO: integrate email sending
              // eslint-disable-next-line no-console
              console.log('Email answers action triggered', surveyAnswers);
              closeModal();
            });
            pdfBtn.addEventListener('click', () => {
              // TODO: integrate PDF generation
              // eslint-disable-next-line no-console
              console.log('Download PDF action triggered', surveyAnswers);
              closeModal();
            });

            return overlay;
          };

          const openSaveAnswersModal = async () => {
            const overlay = await buildSaveAnswersModal();
            if (overlay) {
              overlay.classList.remove('hidden');
              document.body.classList.add('survey-modal-open');
              const focusable = overlay.querySelector('button');
              if (focusable) focusable.focus();
            }
          };

          // Capture authored footer content before replacing
          const footerContentDiv = footerDiv.querySelector('div');
          const authoredContent = footerContentDiv ? footerContentDiv.cloneNode(true) : document.createElement('div');

          // Create footer using template with all components
          const footerContainer = await createFooterContainerTemplate(
            authoredContent,
            await createTemplateContainer('thank-you-message', {}),
            await createTemplateContainer('save-button', {}),
            await createTemplateContainer('learn-more', {}),
          );

          // Replace footer content with template
          replaceContent(footerDiv, footerContainer);

          // Attach event listeners after template is rendered
          const saveButton = footerDiv.querySelector('#save-answers');
          if (saveButton) {
            saveButton.addEventListener('click', async (e) => {
              e.preventDefault();
              await openSaveAnswersModal();
            });
          }

          // Scroll to save button from header link
          const saveLink = surveyArea.querySelector('.save-link');
          if (saveLink) {
            saveLink.addEventListener('click', (e) => {
              e.preventDefault();
              const saveButtonElement = document.getElementById('save-answers');
              if (saveButtonElement) {
                saveButtonElement.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                });
              }
            });
          }
        }
      }
    });
  }

  // Initialize Get Started button
  if (surveyArea) {
    attachGetStartedListener();
  }
}
