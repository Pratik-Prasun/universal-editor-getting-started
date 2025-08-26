// Simple function to fetch survey data using the exact same logic as customform.js
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

export default function decorate(block) {
  if (!block) return;

  // prevent running twice on the same block
  if (block.dataset.decorated === '1') return;
  block.dataset.decorated = '1';

  // capture the top-level divs
  let surveyArea = block.querySelector(':scope > div:nth-child(1)');
  const logo = block.querySelector(':scope > div:nth-child(2)');
  const content = block.querySelector(':scope > div:nth-child(3)');
  const footer = block.querySelector(':scope > div:last-child');

  // create a survey-area wrapper if missing
  if (!surveyArea && (logo || content)) {
    surveyArea = document.createElement('div');
    block.prepend(surveyArea);
  }

  // apply the survey-area class
  if (surveyArea) surveyArea.classList.add('survey-area');

  // handle background picture → CSS background
  const bgWrapper = surveyArea?.querySelector(':scope > div:first-child'); // wrapper div
  const pic = bgWrapper?.querySelector('picture');
  const img = pic?.querySelector('img');

  if (pic && img && surveyArea) {
    const applyBackgroundAndRemove = () => {
      if (img.currentSrc) {
        surveyArea.style.backgroundImage = `url(${img.currentSrc})`;
        surveyArea.classList.add('has-background');
      }
      if (bgWrapper && bgWrapper.parentElement) {
        bgWrapper.parentElement.removeChild(bgWrapper);
      } else if (pic.parentElement) {
        pic.parentElement.removeChild(pic);
      }
    };

    if (img.currentSrc) {
      img.decode()
        .then(applyBackgroundAndRemove)
        .catch(applyBackgroundAndRemove);
    } else {
      img.addEventListener('load', () => {
        img.decode()
          .then(applyBackgroundAndRemove)
          .catch(applyBackgroundAndRemove);
      }, { once: true });
    }
  }

  // move nodes in their original order (logo then content)
  if (logo) {
    logo.classList.add('logo');
    if (surveyArea && logo.parentElement !== surveyArea) {
      surveyArea.appendChild(logo);
    }
  }

  if (content) {
    content.classList.add('content');
    if (surveyArea && content.parentElement !== surveyArea) {
      surveyArea.appendChild(content);
    }
  }

  // Convert button paragraph to div
  const buttonContainer = block.querySelector('p.button-container');
  if (buttonContainer) {
    const div = document.createElement('div');
    div.className = buttonContainer.className;
    div.innerHTML = buttonContainer.innerHTML;
    buttonContainer.parentNode.replaceChild(div, buttonContainer);
  }

  // Function to attach Get Started button listener (defined FIRST)
  function attachGetStartedListener(button, surveyAreaElement) {
    button.addEventListener('click', (e) => {
      e.preventDefault(); // Stop the link from navigating

      // Get survey data path from the button's href
      const surveyDataPath = button.getAttribute('href');

      // Fetch survey data when button is clicked
      if (surveyDataPath) {
        fetchSurveyData(surveyDataPath)
          .then((data) => {
            // eslint-disable-next-line no-console
            console.log('Survey data loaded:', data);
          })
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error('Failed to load survey data:', error);
          });
      }

      // Store the original content (for going back later)
      const originalContent = surveyAreaElement.innerHTML;

      // Replace the survey-area content with the form
      surveyAreaElement.innerHTML = `
        <div class="survey-form">
          <!-- Progress -->
          <div class="progress">
            <div class="progress-track">
              <div class="progress-fill" style="width: 16.67%"></div>
            </div>
            <div class="progress-counter">1/6</div>
          </div>
          <!-- Content -->
          <div class="content">
            <span class="section-title">Your Treatment History</span>
            
            <div class="question-icon">💡</div>
            
            <h2 class="question">How long ago were you first diagnosed with depression?</h2>
            <div class="options">
              <div class="option">
                <input type="radio" id="less-than-1" name="diagnosis-time" value="Less than 1 year">
                <label for="less-than-1">Less than 1 year</label>
              </div>
              <div class="option">
                <input type="radio" id="one-to-two" name="diagnosis-time" value="1-2 years">
                <label for="one-to-two">1-2 years</label>
              </div>
              <div class="option">
                <input type="radio" id="three-to-five" name="diagnosis-time" value="3-5 years">
                <label for="three-to-five">3-5 years</label>
              </div>
              <div class="option">
                <input type="radio" id="more-than-five" name="diagnosis-time" value="More than 5 years">
                <label for="more-than-five">More than 5 years</label>
              </div>
            </div>
            <!-- Navigation -->
            <div class="nav">
              <button type="button" class="btn-back">Back</button>
              <button type="button" class="btn-next">Next</button>
            </div>
          </div>
        </div>
      `;

      // Add back button functionality
      const backButton = surveyAreaElement.querySelector('.btn-back');
      if (backButton) {
        backButton.addEventListener('click', () => {
          // Restore the original content
          surveyAreaElement.innerHTML = originalContent;

          // Re-attach the Get Started button event listener
          const newGetStartedButton = surveyAreaElement.querySelector('.button-container .button');
          if (newGetStartedButton) {
            attachGetStartedListener(newGetStartedButton, surveyAreaElement);
          }
        });
      }

      // Add next button functionality (for testing)
      const nextButton = surveyAreaElement.querySelector('.btn-next');
      if (nextButton) {
        nextButton.addEventListener('click', () => {
          const selectedOption = surveyAreaElement.querySelector('input[name="diagnosis-time"]:checked');
          if (selectedOption) {
            // eslint-disable-next-line no-console
            console.log(`You selected: ${selectedOption.value}`);
          } else {
            // eslint-disable-next-line no-console
            console.log('Please select an option');
          }
        });
      }
    });
  }

  // Add button click handler to replace content with survey form (AFTER function is defined)
  const getStartedButton = block.querySelector('.button-container .button');
  if (getStartedButton && surveyArea) {
    attachGetStartedListener(getStartedButton, surveyArea);
  }

  if (footer) footer.classList.add('footer-content');
}
